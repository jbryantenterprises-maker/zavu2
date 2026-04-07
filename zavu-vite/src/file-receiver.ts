import { FileEncryption } from './encryption.js';
import type { SignalData } from './webrtc.js';

export class FileReceiver {
  private encryptionKey: CryptoKey | null = null;
  private encryptionIV: Uint8Array | null = null;
  private receivedChunks: ArrayBuffer[] = [];
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
    if (data.encryptionKey && data.encryptionIV) {
      try {
        this.encryptionKey = await FileEncryption.base64ToKey(data.encryptionKey);
        this.encryptionIV = FileEncryption.base64ToIV(data.encryptionIV);
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
  handleChunk(chunk: ArrayBuffer, totalSize: number) {
    this.receivedChunks.push(chunk);
    
    const receivedSize = this.receivedChunks.reduce((acc, chunk) => acc + chunk.byteLength, 0);
    const progress = Math.min(Math.round((receivedSize / totalSize) * 100), 100);
    
    if (this.onProgress) {
      this.onProgress(progress);
    }
  }

  /**
   * Complete file reception and decrypt
   */
  async completeFile(fileName: string, mimeType: string): Promise<File | null> {
    try {
      if (!this.encryptionKey || !this.encryptionIV) {
        throw new Error('Encryption keys not available');
      }

      // Combine all received chunks without duplicating memory manually
      const totalEncryptedData = await this.combineChunks();
      
      // Decrypt the data
      const decryptionResult = await FileEncryption.decryptFile(
        totalEncryptedData,
        this.encryptionKey,
        this.encryptionIV
      );

      if (!decryptionResult.success) {
        throw new Error(decryptionResult.error || 'Decryption failed');
      }

      // Create file from decrypted data
      const decryptedFile = new File([decryptionResult.decryptedData], fileName, {
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
   * Combine all received chunks into single ArrayBuffer natively
   */
  private async combineChunks(): Promise<ArrayBuffer> {
    const blob = new Blob(this.receivedChunks);
    return await blob.arrayBuffer();
  }

  /**
   * Reset receiver state for new file
   */
  reset() {
    this.receivedChunks = [];
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
    return this.encryptionKey !== null && this.encryptionIV !== null;
  }
}
