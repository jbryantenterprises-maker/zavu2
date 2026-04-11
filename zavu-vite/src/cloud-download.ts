/**
 * Cloud download handler — decrypts files downloaded from R2 cloud storage.
 *
 * When a user opens a cloud download URL, this module:
 * 1. Parses the decryption key (or password-wrapped bundle) from the URL fragment
 * 2. Fetches the encrypted ciphertext from the server
 * 3. Decrypts client-side (zero-knowledge — server never sees the plaintext)
 * 4. Triggers the browser download
 */
import { FileEncryption } from './encryption.js';

export interface CloudDownloadParams {
  /** True if the key is password-wrapped */
  isPasswordProtected: boolean;
  /** Raw key (base64) — present when not password-protected */
  key?: string;
  /** Wrapped bundle (base64) — present when password-protected */
  wrappedBundle?: string;
  /** PBKDF2 salt (base64) — present when password-protected */
  salt?: string;
  /** Wrap IV (base64) — present when password-protected */
  wrapIV?: string;
}

/**
 * Parse the URL fragment to extract decryption parameters.
 * Returns null if the fragment doesn't contain valid decryption data.
 */
export function parseCloudDownloadFragment(hash: string): CloudDownloadParams | null {
  if (!hash || hash.length < 2) return null;

  const params = new URLSearchParams(hash.slice(1)); // strip leading #

  if (params.get('pw') === '1') {
    const wrappedBundle = params.get('b');
    const salt = params.get('s');
    const wrapIV = params.get('wiv');
    if (!wrappedBundle || !salt || !wrapIV) return null;

    return {
      isPasswordProtected: true,
      wrappedBundle: decodeURIComponent(wrappedBundle),
      salt: decodeURIComponent(salt),
      wrapIV: decodeURIComponent(wrapIV),
    };
  }

  const key = params.get('key');
  if (!key) return null;

  return {
    isPasswordProtected: false,
    key: decodeURIComponent(key),
  };
}

/**
 * Fetch, decrypt, and download a cloud-stored file.
 *
 * @param downloadUrl  The full download URL (without fragment — that's parsed separately)
 * @param params       Decryption parameters from parseCloudDownloadFragment()
 * @param password     Required if params.isPasswordProtected is true
 * @param onProgress   Optional progress callback (0–100)
 */
export async function downloadAndDecryptFile(
  downloadUrl: string,
  params: CloudDownloadParams,
  password?: string,
  onProgress?: (progress: number) => void
): Promise<{ success: boolean; error?: string }> {
  try {
    // ── 1. Resolve decryption key ─────────────────────────────────────
    let cryptoKey: CryptoKey;

    if (params.isPasswordProtected) {
      if (!password) {
        return { success: false, error: 'Password is required to decrypt this file.' };
      }
      if (!params.wrappedBundle || !params.salt || !params.wrapIV) {
        return { success: false, error: 'Incomplete password-protection data in link.' };
      }

      const unwrapped = await FileEncryption.unwrapKeyWithPassword(
        params.wrappedBundle,
        params.salt,
        params.wrapIV,
        password
      );

      if (!unwrapped) {
        return { success: false, error: 'Wrong password. Please try again.' };
      }

      cryptoKey = unwrapped.key;
    } else {
      if (!params.key) {
        return { success: false, error: 'Missing decryption key in link.' };
      }
      cryptoKey = await FileEncryption.base64ToKey(params.key);
    }

    onProgress?.(5);

    // ── 2. Fetch the encrypted file ───────────────────────────────────
    // Strip the fragment from the URL (browsers do this anyway, but be explicit)
    const cleanUrl = downloadUrl.split('#')[0];
    const response = await fetch(cleanUrl);

    if (!response.ok) {
      if (response.status === 403) {
        return { success: false, error: 'Download link is invalid or has expired.' };
      }
      if (response.status === 404) {
        return { success: false, error: 'File not found. It may have been deleted.' };
      }
      return { success: false, error: `Download failed (HTTP ${response.status})` };
    }

    // Read the response as bytes with progress tracking
    const contentLength = Number(response.headers.get('Content-Length')) || 0;
    const reader = response.body?.getReader();
    if (!reader) {
      return { success: false, error: 'Browser does not support streaming downloads.' };
    }

    const decryptedChunks: BlobPart[] = [];
    let receivedBytes = 0;
    let pending = new Uint8Array(0);

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const merged = new Uint8Array(pending.byteLength + value.byteLength);
      merged.set(pending, 0);
      merged.set(value, pending.byteLength);
      pending = merged;
      receivedBytes += value.length;

      while (pending.byteLength >= 4) {
        const frameLength = new DataView(pending.buffer, pending.byteOffset, pending.byteLength).getUint32(0);
        const totalFrameLength = 16 + frameLength;
        if (pending.byteLength < totalFrameLength) break;

        const frame = pending.slice(0, totalFrameLength);
        pending = pending.slice(totalFrameLength);
        const decryptedChunk = await FileEncryption.decryptChunk(frame, cryptoKey);
        decryptedChunks.push(FileEncryption.toArrayBuffer(decryptedChunk));
      }

      if (contentLength > 0) {
        // 5–70% range for download progress
        const dlProgress = 5 + Math.round((receivedBytes / contentLength) * 65);
        onProgress?.(dlProgress);
      }
    }

    if (pending.byteLength > 0) {
      return { success: false, error: 'Download ended with a truncated encrypted chunk.' };
    }

    onProgress?.(75);

    onProgress?.(95);

    // ── 4. Trigger browser download ───────────────────────────────────
    // Try to extract filename from Content-Disposition header
    const contentDisposition = response.headers.get('Content-Disposition') || '';
    let fileName = 'download';
    const filenameMatch = contentDisposition.match(/filename\*?=(?:UTF-8'')?([^;\s]+)/i);
    if (filenameMatch) {
      fileName = decodeURIComponent(filenameMatch[1].replace(/"/g, ''));
    }

    const blob = new Blob(decryptedChunks, { type: 'application/octet-stream' });
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Clean up after a brief delay
    setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000);

    onProgress?.(100);
    return { success: true };
  } catch (error) {
    console.error('Cloud download error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Download failed',
    };
  }
}
