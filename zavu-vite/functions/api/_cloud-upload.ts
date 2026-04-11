import { signDownloadToken, verifyFirebaseJWT, type FirebaseTokenPayload } from './_auth';

export interface CloudUploadEnv {
  ZAVU_BUCKET: R2Bucket;
  FIREBASE_PROJECT_ID: string;
  DOWNLOAD_SIGNING_SECRET: string;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET_NAME?: string;
  MAX_CLOUD_UPLOAD_BYTES?: string;
  MAX_CLOUD_UPLOAD_PART_BYTES?: string;
}

const MIB = 1024 * 1024;
export const MIN_MULTIPART_PART_BYTES = 5 * MIB;
export const DEFAULT_MULTIPART_PART_BYTES = 32 * MIB;
export const DEFAULT_MAX_MULTIPART_PART_BYTES = 95 * MIB;
export const DEFAULT_MAX_CLOUD_UPLOAD_BYTES = DEFAULT_MAX_MULTIPART_PART_BYTES * 10_000;

export async function authenticateUser(
  request: Request,
  env: CloudUploadEnv,
  requirePro = false,
): Promise<FirebaseTokenPayload | Response> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return Response.json({ success: false, error: 'Missing authorization token' }, { status: 401 });
  }

  const user = await verifyFirebaseJWT(authHeader.slice(7), env.FIREBASE_PROJECT_ID);
  if (!user) {
    return Response.json({ success: false, error: 'Invalid or expired token' }, { status: 401 });
  }

  if (requirePro && !user.isPro) {
    return Response.json(
      { success: false, error: 'Pro subscription required for cloud uploads' },
      { status: 403 },
    );
  }

  return user;
}

export function normalizeFileName(input: string): string {
  const normalized = input
    .normalize('NFKC')
    .replace(/[\\/\u0000-\u001f\u007f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180)
    .replace(/[. ]+$/g, '');

  return normalized || 'download';
}

export function parsePositiveInt(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function getMultipartLimits(env: CloudUploadEnv): { maxUploadBytes: number; maxPartBytes: number } {
  const maxPartBytes = parsePositiveInt(env.MAX_CLOUD_UPLOAD_PART_BYTES) ?? DEFAULT_MAX_MULTIPART_PART_BYTES;
  const configuredMaxUploadBytes = parsePositiveInt(env.MAX_CLOUD_UPLOAD_BYTES) ?? DEFAULT_MAX_CLOUD_UPLOAD_BYTES;

  return {
    maxPartBytes,
    maxUploadBytes: Math.min(configuredMaxUploadBytes, maxPartBytes * 10_000),
  };
}

export function computePartSize(fileSize: number, maxPartBytes: number): number | null {
  const target = Math.ceil(fileSize / 10_000);
  const roundedToMiB = Math.ceil(target / MIB) * MIB;
  const partSize = Math.max(DEFAULT_MULTIPART_PART_BYTES, MIN_MULTIPART_PART_BYTES, roundedToMiB);
  return partSize <= maxPartBytes ? partSize : null;
}

export function assertOwnedFile(user: FirebaseTokenPayload, fileId: string): Response | null {
  return fileId.startsWith(`${user.uid}/`)
    ? null
    : Response.json({ success: false, error: 'Cannot access files owned by another user' }, { status: 403 });
}

export async function buildSignedDownload(
  request: Request,
  env: CloudUploadEnv,
  fileId: string,
  expiresAt: number,
): Promise<{ downloadUrl: string; expiresAt: number }> {
  const token = await signDownloadToken(fileId, expiresAt, env.DOWNLOAD_SIGNING_SECRET);
  const origin = new URL(request.url).origin;
  return {
    downloadUrl: `${origin}/api/download/${encodeURIComponent(fileId)}?token=${token}&expires=${expiresAt}`,
    expiresAt,
  };
}

export async function createPresignedUploadPartUrl(
  env: CloudUploadEnv,
  fileId: string,
  uploadId: string,
  partNumber: number,
  expiresInSeconds = 900,
): Promise<string> {
  if (!env.R2_ACCOUNT_ID || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY || !env.R2_BUCKET_NAME) {
    throw new Error('R2 presigning credentials are not configured');
  }

  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const host = `${env.R2_BUCKET_NAME}.${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const pathname = `/${encodeR2Path(fileId)}`;

  const params = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Content-Sha256': 'UNSIGNED-PAYLOAD',
    'X-Amz-Credential': `${env.R2_ACCESS_KEY_ID}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresInSeconds),
    'X-Amz-SignedHeaders': 'host',
    'partNumber': String(partNumber),
    'uploadId': uploadId,
  });

  const canonicalQuery = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${awsEncode(key)}=${awsEncode(value)}`)
    .join('&');

  const canonicalRequest = [
    'PUT',
    pathname,
    canonicalQuery,
    `host:${host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = await getSignatureKey(env.R2_SECRET_ACCESS_KEY, dateStamp, 'auto', 's3');
  const signature = await hmacHex(signingKey, stringToSign);
  params.set('X-Amz-Signature', signature);

  return `https://${host}${pathname}?${params.toString()}`;
}

function encodeR2Path(path: string): string {
  return path.split('/').map(awsEncode).join('/');
}

function awsEncode(value: string): string {
  return encodeURIComponent(value).replace(/[!*'()]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function toAmzDate(date: Date): string {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return toHex(new Uint8Array(digest));
}

async function getSignatureKey(secret: string, dateStamp: string, region: string, service: string): Promise<ArrayBuffer> {
  const kDate = await hmacRaw(new TextEncoder().encode(`AWS4${secret}`), dateStamp);
  const kRegion = await hmacRaw(kDate, region);
  const kService = await hmacRaw(kRegion, service);
  return hmacRaw(kService, 'aws4_request');
}

async function hmacRaw(key: BufferSource, value: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(value));
}

async function hmacHex(key: BufferSource, value: string): Promise<string> {
  const digest = await hmacRaw(key, value);
  return toHex(new Uint8Array(digest));
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
