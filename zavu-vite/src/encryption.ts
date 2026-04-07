export interface EncryptionResult {
  encryptedData: ArrayBuffer;
  key: CryptoKey;
  iv: Uint8Array;
}

export interface DecryptionResult {
  decryptedData: ArrayBuffer;
  success: boolean;
  error?: string;
}

export class FileEncryption {
  private static readonly ALGORITHM = 'AES-GCM';
  private static readonly KEY_LENGTH = 256;

  /**
   * Generate a new encryption key for each file transfer
   */
  static async generateKey(): Promise<CryptoKey> {
    return await window.crypto.subtle.generateKey(
      {
        name: this.ALGORITHM,
        length: this.KEY_LENGTH,
      },
      true, // extractable so we can send it to receiver
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Generate a random initialization vector
   */
  static generateIV(): Uint8Array {
    return window.crypto.getRandomValues(new Uint8Array(12)); // 96 bits for AES-GCM
  }

  /**
   * Encrypt a file before sending
   */
  static async encryptFile(
    file: ArrayBuffer,
    existingKey?: CryptoKey,
    existingIV?: Uint8Array
  ): Promise<EncryptionResult> {
    try {
      const key = existingKey || await this.generateKey();
      const iv = existingIV || this.generateIV();

      const encryptedData = await window.crypto.subtle.encrypt(
        {
          name: this.ALGORITHM,
          iv: iv.buffer as ArrayBuffer,
        },
        key,
        file
      );

      return {
        encryptedData,
        key,
        iv
      };
    } catch (error) {
      throw new Error(`Encryption failed: ${error}`);
    }
  }

  /**
   * Decrypt a file after receiving
   */
  static async decryptFile(
    encryptedData: ArrayBuffer,
    key: CryptoKey,
    iv: Uint8Array
  ): Promise<DecryptionResult> {
    try {
      const decryptedData = await window.crypto.subtle.decrypt(
        {
          name: this.ALGORITHM,
          iv: new Uint8Array(iv),
        },
        key,
        encryptedData
      );

      return {
        decryptedData,
        success: true
      };
    } catch (error) {
      return {
        decryptedData: new ArrayBuffer(0),
        success: false,
        error: `Decryption failed: ${error}`
      };
    }
  }

  /**
   * Convert CryptoKey to base64 string for transmission
   */
  static async keyToBase64(key: CryptoKey): Promise<string> {
    const exportedKey = await window.crypto.subtle.exportKey('raw', key);
    return this.arrayBufferToBase64(exportedKey);
  }

  /**
   * Convert base64 string back to CryptoKey
   */
  static async base64ToKey(base64Key: string): Promise<CryptoKey> {
    const keyData = this.base64ToArrayBuffer(base64Key);
    return await window.crypto.subtle.importKey(
      'raw',
      new Uint8Array(keyData),
      {
        name: this.ALGORITHM,
        length: this.KEY_LENGTH,
      },
      true,
      ['encrypt', 'decrypt']
    );
  }

  /**
   * Convert IV to base64 string for transmission
   */
  static ivToBase64(iv: Uint8Array): string {
    const buffer = new ArrayBuffer(iv.length);
    const view = new Uint8Array(buffer);
    view.set(iv);
    return this.arrayBufferToBase64(buffer);
  }

  /**
   * Convert base64 string back to IV
   */
  static base64ToIV(base64IV: string): Uint8Array {
    const arrayBuffer = this.base64ToArrayBuffer(base64IV);
    return new Uint8Array(arrayBuffer);
  }

  /**
   * Helper: Convert ArrayBuffer to base64
   */
  private static arrayBufferToBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Helper: Convert base64 to ArrayBuffer
   */
  private static base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const buffer = new ArrayBuffer(binary.length);
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return buffer;
  }

  /**
   * Encrypt file in chunks for large files
   */
  static async encryptFileInChunks(
    file: ArrayBuffer,
    chunkSize: number = 1024 * 1024, // 1MB chunks
    onProgress?: (progress: number) => void
  ): Promise<{
    encryptedChunks: ArrayBuffer[];
    key: CryptoKey;
    iv: Uint8Array;
  }> {
    const key = await this.generateKey();
    const iv = this.generateIV();
    const encryptedChunks: ArrayBuffer[] = [];
    
    const totalChunks = Math.ceil(file.byteLength / chunkSize);
    
    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize;
      const end = Math.min(start + chunkSize, file.byteLength);
      const chunk = file.slice(start, end);
      
      const encryptedChunk = await window.crypto.subtle.encrypt(
        {
          name: this.ALGORITHM,
          iv: new Uint8Array(iv), // Note: For chunked encryption, you might want different IVs per chunk
        },
        key,
        chunk
      );
      
      encryptedChunks.push(encryptedChunk);
      
      if (onProgress) {
        onProgress(((i + 1) / totalChunks) * 100);
      }
    }
    
    return {
      encryptedChunks,
      key,
      iv
    };
  }
}
