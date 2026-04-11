/**
 * Cloud storage service — uses Pages Functions to create and finalize
 * multipart upload sessions, while the browser sends encrypted parts
 * directly to R2 using presigned URLs.
 *
 * Files are encrypted client-side (AES-GCM) before upload — the server
 * only ever sees ciphertext. The decryption key is embedded in the URL
 * fragment (#key=...) which is never sent to the server.
 *
 * Optional password protection adds a PBKDF2 key-wrapping layer:
 * the raw key is encrypted with a password-derived key, and the
 * wrapped bundle replaces the raw key in the fragment.
 */
import type { FileMetadata } from './webrtc.js';
import { AuthService } from './auth.js';
import { FileEncryption } from './encryption.js';

export interface UploadResult {
  success: boolean;
  downloadUrl?: string;
  error?: string;
  fileId?: string;
  expiresAt?: number;
}

export class CloudStorageService {
  /**
   * The service is "configured" as long as the API endpoint exists.
   * Actual R2 config lives on the server side.
   */
  isConfigured(): boolean {
    return true;
  }

  /**
   * Encrypt a file client-side, upload the ciphertext to R2 via the Pages
   * Function, and return a download URL with the decryption key in the
   * URL fragment (zero-knowledge).
   *
   * If `password` is provided, the key in the fragment is itself wrapped
   * with a PBKDF2-derived key — the recipient must know the password.
   */
  async uploadFile(
    file: File,
    _metadata: FileMetadata,
    password?: string
  ): Promise<UploadResult> {
    let activeFileId: string | null = null;
    let activeUploadId: string | null = null;

    try {
      // ── 1. Prepare client-side encryption ───────────────────────────
      const encKey = await FileEncryption.generateKey();
      const fileStream = file.stream();
      const reader = fileStream.getReader();
      const session = await this.createMultipartUpload(file);
      if (!session.success || !session.fileId || !session.uploadId || !session.partSize) {
        return {
          success: false,
          error: session.error || 'Failed to create cloud upload session',
        };
      }
      activeFileId = session.fileId;
      activeUploadId = session.uploadId;

      const uploadedParts: Array<{ partNumber: number; etag: string }> = [];
      const bufferedFrames: Uint8Array[] = [];
      let bufferedBytes = 0;
      let partNumber = 1;

      const flushPart = async () => {
        if (bufferedBytes === 0) return;
        const partData = this.concatUint8Arrays(bufferedFrames, bufferedBytes);
        const uploadedPart = await this.uploadPart(session.fileId!, session.uploadId!, partNumber, partData);
        if (!uploadedPart.success || !uploadedPart.etag || !uploadedPart.partNumber) {
          throw new Error(uploadedPart.error || `Failed to upload part ${partNumber}`);
        }

        uploadedParts.push({
          partNumber: uploadedPart.partNumber,
          etag: uploadedPart.etag,
        });
        bufferedFrames.length = 0;
        bufferedBytes = 0;
        partNumber += 1;
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const encryptedChunk = await FileEncryption.encryptChunk(value, encKey);
        bufferedFrames.push(encryptedChunk);
        bufferedBytes += encryptedChunk.byteLength;

        if (bufferedBytes >= session.partSize) {
          await flushPart();
        }
      }

      if (bufferedBytes > 0 || uploadedParts.length === 0) {
        await flushPart();
      }

      const result = await this.completeMultipartUpload(session.fileId, session.uploadId, uploadedParts);
      if (!result.success || !result.downloadUrl) {
        throw new Error(result.error || 'Failed to finalize cloud upload');
      }

      // ── 3. Build the fragment with decryption material ──────────────
      // Fragments (#...) are never sent to the server — zero-knowledge.
      let fragment: string;

      if (password) {
        // Password-protected: wrap the key+IV with the password
        const wrapped = await FileEncryption.wrapKeyWithPassword(
          encKey,
          new Uint8Array(0),
          password
        );
        fragment = `#pw=1&b=${encodeURIComponent(wrapped.wrappedBundle)}&s=${encodeURIComponent(wrapped.salt)}&wiv=${encodeURIComponent(wrapped.wrapIV)}`;
      } else {
        // No password: raw key in fragment. Each chunk carries its own IV.
        const keyB64 = await FileEncryption.keyToBase64(encKey);
        fragment = `#key=${encodeURIComponent(keyB64)}`;
      }

      const downloadUrl = (result.downloadUrl || '') + fragment;

      return {
        success: true,
        downloadUrl,
        fileId: result.fileId || session.fileId,
        expiresAt: result.expiresAt,
      };
    } catch (error) {
      if (activeFileId && activeUploadId) {
        await this.abortMultipartUpload(activeFileId, activeUploadId);
      }
      console.error('Cloud upload error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error during upload',
      };
    }
  }

  private async createMultipartUpload(file: File): Promise<{
    success: boolean;
    error?: string;
    fileId?: string;
    uploadId?: string;
    expiresAt?: number;
    partSize?: number;
  }> {
    const idToken = await AuthService.getIdToken();
    if (!idToken) {
      return { success: false, error: 'Not authenticated. Please sign in.' };
    }

    const response = await fetch('/api/upload', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fileName: file.name,
        fileSize: file.size,
      }),
    });

    const result = await response.json() as {
      success: boolean;
      error?: string;
      fileId?: string;
      uploadId?: string;
      expiresAt?: number;
      partSize?: number;
    };

    if (!response.ok || !result.success) {
      return {
        success: false,
        error: result.error || `Upload session failed (HTTP ${response.status})`,
      };
    }

    return result;
  }

  private async uploadPart(
    fileId: string,
    uploadId: string,
    partNumber: number,
    body: Uint8Array,
  ): Promise<{ success: boolean; error?: string; etag?: string; partNumber?: number }> {
    const idToken = await AuthService.getIdToken();
    if (!idToken) {
      return { success: false, error: 'Not authenticated. Please sign in.' };
    }

    const signResponse = await fetch('/api/upload/sign-part', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fileId,
        uploadId,
        partNumber,
      }),
    });

    const signed = await signResponse.json() as {
      success: boolean;
      error?: string;
      presignedUrl?: string;
    };

    if (!signResponse.ok || !signed.success || !signed.presignedUrl) {
      return {
        success: false,
        error: signed.error || `Part signing failed (HTTP ${signResponse.status})`,
      };
    }

    const uploadResponse = await fetch(signed.presignedUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/octet-stream',
      },
      body: FileEncryption.toArrayBuffer(body),
    });

    if (!uploadResponse.ok) {
      return {
        success: false,
        error: `Direct part upload failed (HTTP ${uploadResponse.status})`,
      };
    }

    const etag = uploadResponse.headers.get('etag')?.replace(/"/g, '');
    if (!etag) {
      return {
        success: false,
        error: 'Direct part upload did not return an ETag. Check R2 CORS expose headers.',
      };
    }

    return {
      success: true,
      partNumber,
      etag,
    };
  }

  private async completeMultipartUpload(
    fileId: string,
    uploadId: string,
    parts: Array<{ partNumber: number; etag: string }>,
  ): Promise<UploadResult> {
    const idToken = await AuthService.getIdToken();
    if (!idToken) {
      return { success: false, error: 'Not authenticated. Please sign in.' };
    }

    const response = await fetch('/api/upload/complete', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fileId,
        uploadId,
        parts,
      }),
    });

    const result = await response.json() as UploadResult;
    if (!response.ok || !result.success) {
      return {
        success: false,
        error: result.error || `Upload completion failed (HTTP ${response.status})`,
      };
    }

    return result;
  }

  private async abortMultipartUpload(fileId: string, uploadId: string): Promise<void> {
    const idToken = await AuthService.getIdToken();
    if (!idToken) return;

    await fetch('/api/upload/abort', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${idToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ fileId, uploadId }),
    }).catch(() => undefined);
  }

  private concatUint8Arrays(chunks: Uint8Array[], totalBytes: number): Uint8Array {
    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return combined;
  }

  async deleteFiles(fileIds: string[]): Promise<{ success: boolean; deletedCount?: number; error?: string }> {
    if (fileIds.length === 0) {
      return { success: true, deletedCount: 0 };
    }

    const idToken = await AuthService.getIdToken();
    if (!idToken) {
      return { success: false, error: 'Not authenticated. Please sign in.' };
    }

    try {
      const response = await fetch('/api/delete', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fileIds }),
      });

      const result = await response.json() as {
        success: boolean;
        deletedCount?: number;
        error?: string;
      };

      if (!response.ok || !result.success) {
        return {
          success: false,
          error: result.error || `Delete failed (HTTP ${response.status})`,
        };
      }

      return { success: true, deletedCount: result.deletedCount ?? fileIds.length };
    } catch (error) {
      console.error('Cloud delete error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error during delete',
      };
    }
  }
}
