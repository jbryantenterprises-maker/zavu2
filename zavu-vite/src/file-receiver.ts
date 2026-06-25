import { FileEncryption } from './encryption.js';
import type { SignalData, TransferMetadata } from './webrtc.js';

export class FileReceiver {
  private encryptionKey: CryptoKey | null = null;
  private decryptedChunks: BlobPart[] = [];
  private receivedBytes = 0;
  private fileMetadata: TransferMetadata | null = null;
  private onProgress?: (progress: number) => void;
  private onComplete?: (file: File) => void;
  private onError?: (error: string) => void;
  private pendingChunks: Array<{ chunk: ArrayBuffer; totalSize: number }> = [];
  private keyRetryTimer: NodeJS.Timeout | null = null;
  private readonly KEY_RETRY_TIMEOUT_MS = 10000; // 10 seconds to wait for encryption key

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
        if (!data.files || typeof data.totalSize !== 'number') {
          throw new Error('Transfer metadata is incomplete');
        }
        this.encryptionKey = await FileEncryption.base64ToKey(data.encryptionKey);
        this.fileMetadata = { files: data.files, totalSize: data.totalSize };
        
        // Clear any pending retry timer
        if (this.keyRetryTimer) {
          clearTimeout(this.keyRetryTimer);
          this.keyRetryTimer = null;
        }
        
        // Process any pending chunks that were waiting for the encryption key
        if (this.pendingChunks.length > 0) {
          console.log('🔐 Processing pending chunks after receiving encryption key');
          const pending = [...this.pendingChunks];
          this.pendingChunks = [];
          for (const { chunk, totalSize } of pending) {
            await this.handleChunk(chunk, totalSize);
          }
        }
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
    console.log('🔐 FileReceiver.handleChunk:', {
      chunkSize: chunk.byteLength,
      totalSize,
      hasEncryptionKey: !!this.encryptionKey
    });

    if (!this.encryptionKey) {
      // Store chunk for later processing when encryption key arrives
      console.log('⏳ Encryption key not available, storing chunk for retry');
      this.pendingChunks.push({ chunk, totalSize });
      
      // Set up retry timer if not already set
      if (!this.keyRetryTimer) {
        this.keyRetryTimer = setTimeout(() => {
          if (!this.encryptionKey && this.pendingChunks.length > 0) {
            console.error('❌ Timeout waiting for encryption key');
            if (this.onError) {
              this.onError('Encryption key not received within timeout period');
            }
            this.pendingChunks = [];
          }
          this.keyRetryTimer = null;
        }, this.KEY_RETRY_TIMEOUT_MS);
      }
      return;
    }

    const decryptedChunk = await FileEncryption.decryptChunk(chunk, this.encryptionKey);
    console.log('🔓 Decrypted chunk:', {
      decryptedSize: decryptedChunk.byteLength,
      totalReceived: this.receivedBytes + decryptedChunk.byteLength
    });

    this.decryptedChunks.push(FileEncryption.toArrayBuffer(decryptedChunk));
    this.receivedBytes += decryptedChunk.byteLength;

    const progress = totalSize > 0
      ? Math.min(Math.round((this.receivedBytes / totalSize) * 100), 100)
      : 100;

    console.log('📊 Progress:', { receivedBytes: this.receivedBytes, totalSize, progress });

    if (this.onProgress) {
      this.onProgress(progress);
    }
  }

  /**
   * Complete file reception and decrypt
   */
  async completeFile(fileName: string, mimeType: string): Promise<File | null> {
    try {
      console.log('📁 Completing file:', {
        fileName,
        mimeType,
        chunksCount: this.decryptedChunks.length,
        totalReceivedBytes: this.receivedBytes
      });

      if (!this.encryptionKey) {
        throw new Error('Encryption keys not available');
      }

      // Create file from decrypted data
      const decryptedFile = new File(this.decryptedChunks, fileName, {
        type: mimeType || 'application/octet-stream'
      });

      console.log('✅ File created:', {
        fileName,
        fileSize: decryptedFile.size,
        fileType: decryptedFile.type
      });

      if (this.onComplete) {
        this.onComplete(decryptedFile);
      }

      return decryptedFile;
    } catch (error) {
      console.error('❌ File completion error:', error);
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
    this.pendingChunks = [];
    if (this.keyRetryTimer) {
      clearTimeout(this.keyRetryTimer);
      this.keyRetryTimer = null;
    }
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
