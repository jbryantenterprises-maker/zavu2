/**
 * Cloud storage service — calls the Pages Functions backend at /api/upload
 * instead of connecting directly to R2 from the client.
 *
 * The backend handles:
 * - Firebase JWT verification
 * - Pro status enforcement
 * - R2 storage via native bindings (secrets never leave the server)
 * - HMAC-signed 7-day download URL generation
 */
import type { FileMetadata } from './webrtc.js';
import { AuthService } from './auth.js';

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

  async uploadFile(file: File, _metadata: FileMetadata): Promise<UploadResult> {
    // Get the Firebase ID token for authentication
    const idToken = await AuthService.getIdToken();
    if (!idToken) {
      return { success: false, error: 'Not authenticated. Please sign in.' };
    }

    try {
      const formData = new FormData();
      formData.append('file', file);

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

      return {
        success: true,
        downloadUrl: result.downloadUrl,
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
