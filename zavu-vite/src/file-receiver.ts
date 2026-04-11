import { FileEncryption } from './encryption.js';
import type { SignalData } from './webrtc.js';

export class FileReceiver {
  private encryptionKey: CryptoKey | null = null;
  private decryptedChunks: BlobPart[] = [];
  private receivedBytes = 0;
  private fileMetadata: any = null;
  private onProgress?: (progress: number) => void;
  private onComplete?: (file: File) => void;
  private onError?: (error: string) => void;

  constructor(
    onProgress?: (progress: number) => void,
    onComplete?: (file: File) => void,
    onError?: (error: string) => void
  ) {
    this.onProgress = onProgress;
    this.onComplete = onComplete;
    this.onError = onError;
  }

  /**
   * Handle metadata signal with encryption keys
   */
  async handleMetadata(data: SignalData) {
    if (data.encryptionKey) {
      try {
        this.encryptionKey = await FileEncryption.base64ToKey(data.encryptionKey);
        this.fileMetadata = { files: data.files, totalSize: data.totalSize };
      } catch (error) {
        if (this.onError) {
          this.onError(`Failed to setup encryption: ${error}`);
        }
      }
    }
  }

  /**
   * Handle incoming encrypted chunk
   */
  async handleChunk(chunk: ArrayBuffer, totalSize: number) {
    if (!this.encryptionKey) {
      throw new Error('Encryption key not available');
    }

    const decryptedChunk = await FileEncryption.decryptChunk(chunk, this.encryptionKey);
    this.decryptedChunks.push(FileEncryption.toArrayBuffer(decryptedChunk));
    this.receivedBytes += decryptedChunk.byteLength;

    const progress = Math.min(Math.round((this.receivedBytes / totalSize) * 100), 100);

    if (this.onProgress) {
      this.onProgress(progress);
    }
  }

  /**
   * Complete file reception and decrypt
   */
  async completeFile(fileName: string, mimeType: string): Promise<File | null> {
    try {
      if (!this.encryptionKey) {
        throw new Error('Encryption keys not available');
      }

      // Create file from decrypted data
      const decryptedFile = new File(this.decryptedChunks, fileName, {
        type: mimeType || 'application/octet-stream'
      });

      if (this.onComplete) {
        this.onComplete(decryptedFile);
      }

      return decryptedFile;
    } catch (error) {
      if (this.onError) {
        this.onError(`File decryption failed: ${error}`);
      }
      return null;
    }
  }

  /**
   * Reset receiver state for new file
   */
  reset() {
    this.decryptedChunks = [];
    this.receivedBytes = 0;
  }

  /**
   * Get file metadata
   */
  getMetadata() {
    return this.fileMetadata;
  }

  /**
   * Check if encryption is enabled
   */
  isEncryptionEnabled(): boolean {
    return this.encryptionKey !== null;
  }
}
