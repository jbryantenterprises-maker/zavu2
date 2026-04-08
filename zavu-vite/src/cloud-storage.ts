/**
 * Cloud storage service — calls the Pages Functions backend at /api/upload
 * instead of connecting directly to R2 from the client.
 *
 * Files are encrypted client-side (AES-GCM) before upload — the server
 * only ever sees ciphertext. The decryption key is embedded in the URL
 * fragment (#key=...&iv=...) which is never sent to the server.
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
    // Get the Firebase ID token for authentication
    const idToken = await AuthService.getIdToken();
    if (!idToken) {
      return { success: false, error: 'Not authenticated. Please sign in.' };
    }

    try {
      // ── 1. Encrypt the file client-side ─────────────────────────────
      const fileBuffer = await file.arrayBuffer();
      const encKey = await FileEncryption.generateKey();
      const encIV = FileEncryption.generateIV();
      const { encryptedData } = await FileEncryption.encryptFile(
        fileBuffer,
        encKey,
        encIV
      );

      // ── 2. Upload the ciphertext ────────────────────────────────────
      const encryptedBlob = new Blob([encryptedData], {
        type: 'application/octet-stream',
      });
      const encryptedFile = new File([encryptedBlob], file.name, {
        type: 'application/octet-stream',
      });

      const formData = new FormData();
      formData.append('file', encryptedFile);

      const response = await fetch('/api/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${idToken}`,
        },
        body: formData,
      });

      const result = await response.json() as {
        success: boolean;
        downloadUrl?: string;
        fileId?: string;
        error?: string;
      };

      if (!response.ok || !result.success) {
        return {
          success: false,
          error: result.error || `Upload failed (HTTP ${response.status})`,
        };
      }

      // ── 3. Build the fragment with decryption material ──────────────
      // Fragments (#...) are never sent to the server — zero-knowledge.
      let fragment: string;

      if (password) {
        // Password-protected: wrap the key+IV with the password
        const wrapped = await FileEncryption.wrapKeyWithPassword(
          encKey,
          encIV,
          password
        );
        fragment = `#pw=1&b=${encodeURIComponent(wrapped.wrappedBundle)}&s=${encodeURIComponent(wrapped.salt)}&wiv=${encodeURIComponent(wrapped.wrapIV)}`;
      } else {
        // No password: raw key+IV in fragment
        const keyB64 = await FileEncryption.keyToBase64(encKey);
        const ivB64 = FileEncryption.ivToBase64(encIV);
        fragment = `#key=${encodeURIComponent(keyB64)}&iv=${encodeURIComponent(ivB64)}`;
      }

      const downloadUrl = (result.downloadUrl || '') + fragment;

      return {
        success: true,
        downloadUrl,
        fileId: result.fileId,
      };
    } catch (error) {
      console.error('Cloud upload error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error during upload',
      };
    }
  }
}
