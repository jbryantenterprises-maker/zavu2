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

  // ── Password-Based Key Wrapping (PBKDF2) ─────────────────────────────

  /**
   * Derive an AES-KW key from a user-supplied password via PBKDF2.
   * Returns the derived key and the random salt used (salt must be stored/sent alongside).
   */
  static async deriveKeyFromPassword(
    password: string,
    salt?: Uint8Array
  ): Promise<{ derivedKey: CryptoKey; salt: Uint8Array }> {
    const actualSalt = salt || window.crypto.getRandomValues(new Uint8Array(16));

    const passwordKey = await window.crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    const derivedKey = await window.crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: new Uint8Array(actualSalt.buffer as ArrayBuffer),
        iterations: 310_000, // OWASP recommended minimum for PBKDF2-SHA256
        hash: 'SHA-256',
      },
      passwordKey,
      { name: this.ALGORITHM, length: this.KEY_LENGTH },
      false,
      ['encrypt', 'decrypt']
    );

    return { derivedKey, salt: actualSalt };
  }

  /**
   * Encrypt (wrap) an AES-GCM file key + IV using a password.
   * Returns the encrypted bundle and salt as base64 strings.
   * The bundle format is: AES-GCM ciphertext of JSON { key: base64, iv: base64 }
   */
  static async wrapKeyWithPassword(
    fileKey: CryptoKey,
    fileIV: Uint8Array,
    password: string
  ): Promise<{ wrappedBundle: string; salt: string; wrapIV: string }> {
    const { derivedKey, salt } = await this.deriveKeyFromPassword(password);
    const wrapIV = this.generateIV();

    // Serialize the file key + IV into a JSON payload
    const keyBase64 = await this.keyToBase64(fileKey);
    const ivBase64 = this.ivToBase64(fileIV);
    const payload = JSON.stringify({ key: keyBase64, iv: ivBase64 });

    const encrypted = await window.crypto.subtle.encrypt(
      { name: this.ALGORITHM, iv: new Uint8Array(wrapIV.buffer as ArrayBuffer) },
      derivedKey,
      new TextEncoder().encode(payload)
    );

    return {
      wrappedBundle: this.arrayBufferToBase64(encrypted),
      salt: this.arrayBufferToBase64(salt.buffer as ArrayBuffer),
      wrapIV: this.ivToBase64(wrapIV),
    };
  }

  /**
   * Decrypt (unwrap) an AES-GCM file key + IV using a password.
   * Returns null if the password is wrong.
   */
  static async unwrapKeyWithPassword(
    wrappedBundle: string,
    salt: string,
    wrapIV: string,
    password: string
  ): Promise<{ key: CryptoKey; iv: Uint8Array } | null> {
    try {
      const saltBytes = new Uint8Array(this.base64ToArrayBuffer(salt));
      const { derivedKey } = await this.deriveKeyFromPassword(password, saltBytes);
      const wrapIVBytes = this.base64ToIV(wrapIV);

      const decrypted = await window.crypto.subtle.decrypt(
        { name: this.ALGORITHM, iv: new Uint8Array(wrapIVBytes.buffer as ArrayBuffer) },
        derivedKey,
        this.base64ToArrayBuffer(wrappedBundle)
      );

      const payload = JSON.parse(new TextDecoder().decode(decrypted));
      const key = await this.base64ToKey(payload.key);
      const iv = this.base64ToIV(payload.iv);

      return { key, iv };
    } catch {
      // Wrong password or corrupted data
      return null;
    }
  }
}

