/**
 * Shared auth utilities for Pages Functions.
 *
 * - verifyFirebaseJWT: validates a Firebase Auth ID token using Google's public keys
 * - signDownloadToken / verifyDownloadToken: HMAC-based signed URLs for 7-day downloads
 */
import { jwtVerify, createRemoteJWKSet } from 'jose';

// ── Firebase JWT Verification ──────────────────────────────────────────

// Google publishes Firebase Auth public keys as a JWKS endpoint
const FIREBASE_JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
);

export interface FirebaseTokenPayload {
  uid: string;
  email?: string;
  name?: string;
  isPro: boolean;
  [key: string]: unknown;
}

/**
 * Verify a Firebase ID token and extract the user info.
 * Returns null if the token is invalid or expired.
 */
export async function verifyFirebaseJWT(
  token: string,
  projectId: string
): Promise<FirebaseTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, FIREBASE_JWKS, {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
    });

    const uid = payload.sub;
    if (!uid) return null;

    // Check for Pro status via Firebase custom claims.
    // Your Lemon Squeezy webhook should set a custom claim like { pro: true }
    // on the Firebase user after purchase.
    const isPro = !!(
      (payload as any).pro ||
      (payload as any).stripeRole === 'pro' ||
      (payload as any).plan === 'pro'
    );

    return {
      uid,
      email: payload.email as string | undefined,
      name: payload.name as string | undefined,
      isPro,
    };
  } catch (err) {
    console.error('Firebase JWT verification failed:', err);
    return null;
  }
}

// ── HMAC Download Token Signing ────────────────────────────────────────

/**
 * Generate an HMAC-SHA256 signed download token.
 * The token encodes the file ID and an expiry timestamp.
 */
export async function signDownloadToken(
  fileId: string,
  expiresAt: number,
  secret: string
): Promise<string> {
  const data = `${fileId}:${expiresAt}`;
  const key = await importHmacKey(secret);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return bufferToHex(signature);
}

/**
 * Verify an HMAC-SHA256 signed download token.
 * Returns true if the signature is valid and the link hasn't expired.
 */
export async function verifyDownloadToken(
  fileId: string,
  expiresAt: number,
  token: string,
  secret: string
): Promise<boolean> {
  // Check expiry first
  if (Date.now() > expiresAt) return false;

  const expected = await signDownloadToken(fileId, expiresAt, secret);
  return timingSafeEqual(expected, token);
}

// ── Helpers ────────────────────────────────────────────────────────────

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

function bufferToHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time string comparison to prevent timing attacks */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
