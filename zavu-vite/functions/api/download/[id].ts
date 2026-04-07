/**
 * GET /api/download/:id
 *
 * Serves a file from R2 if the HMAC-signed download token is valid and not expired.
 * No authentication required — the signed URL IS the authorization.
 *
 * Query params:
 *   token   — HMAC-SHA256 signature
 *   expires — expiry timestamp in ms
 */
import { verifyDownloadToken } from '../_auth';

interface Env {
  ZAVU_BUCKET: R2Bucket;
  DOWNLOAD_SIGNING_SECRET: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { request, env, params } = context;

  // ── 1. Extract params ──────────────────────────────────────────────
  // The [id] param captures the full path after /api/download/
  const fileId = decodeURIComponent(params.id as string);
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  const expiresStr = url.searchParams.get('expires');

  if (!token || !expiresStr || !fileId) {
    return new Response('Missing download parameters', { status: 400 });
  }

  const expiresAt = parseInt(expiresStr, 10);
  if (isNaN(expiresAt)) {
    return new Response('Invalid expiry', { status: 400 });
  }

  // ── 2. Verify the signed token ────────────────────────────────────
  const isValid = await verifyDownloadToken(fileId, expiresAt, token, env.DOWNLOAD_SIGNING_SECRET);
  if (!isValid) {
    return new Response('Download link is invalid or has expired', { status: 403 });
  }

  // ── 3. Fetch from R2 ─────────────────────────────────────────────
  const object = await env.ZAVU_BUCKET.get(fileId);
  if (!object) {
    return new Response('File not found', { status: 404 });
  }

  // Extract the original filename from the R2 key (uid/uuid/filename.ext)
  const fileName = fileId.split('/').pop() || 'download';
  const safeName = encodeURIComponent(fileName).replace(/['()]/g, escape);

  // ── 4. Stream the file to the client ──────────────────────────────
  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream');
  headers.set('Content-Disposition', `attachment; filename*=UTF-8''${safeName}`);
  headers.set('Content-Length', object.size.toString());
  // Cache the response for repeat downloads within the validity window
  headers.set('Cache-Control', 'private, max-age=3600');

  return new Response(object.body, { headers });
};
