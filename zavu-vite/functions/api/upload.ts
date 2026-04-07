/**
 * POST /api/upload
 *
 * Accepts a file upload from a Pro user and stores it in R2.
 * Returns an HMAC-signed download URL valid for 7 days.
 *
 * Headers:
 *   Authorization: Bearer <firebase-id-token>
 *
 * Body: multipart/form-data with a "file" field
 *
 * Response: { success: true, downloadUrl: string, fileId: string }
 */
import { verifyFirebaseJWT, signDownloadToken } from './_auth';

interface Env {
  ZAVU_BUCKET: R2Bucket;
  FIREBASE_PROJECT_ID: string;
  DOWNLOAD_SIGNING_SECRET: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  // ── 1. Authenticate ────────────────────────────────────────────────
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return Response.json({ success: false, error: 'Missing authorization token' }, { status: 401 });
  }

  const idToken = authHeader.slice(7);
  const user = await verifyFirebaseJWT(idToken, env.FIREBASE_PROJECT_ID);
  if (!user) {
    return Response.json({ success: false, error: 'Invalid or expired token' }, { status: 401 });
  }

  // ── 2. Verify Pro status ───────────────────────────────────────────
  if (!user.isPro) {
    return Response.json(
      { success: false, error: 'Pro subscription required for cloud uploads' },
      { status: 403 }
    );
  }

  // ── 3. Parse the uploaded file ─────────────────────────────────────
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ success: false, error: 'Invalid form data' }, { status: 400 });
  }

  const file = formData.get('file') as File | null;
  if (!file) {
    return Response.json({ success: false, error: 'No file provided' }, { status: 400 });
  }

  // ── 4. Store in R2 ────────────────────────────────────────────────
  const fileId = crypto.randomUUID();
  const r2Key = `${user.uid}/${fileId}/${file.name}`;

  try {
    await env.ZAVU_BUCKET.put(r2Key, file.stream(), {
      httpMetadata: {
        contentType: file.type || 'application/octet-stream',
      },
      customMetadata: {
        originalName: file.name,
        uploadedBy: user.uid,
        uploadedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error('R2 upload failed:', err);
    return Response.json({ success: false, error: 'Storage upload failed' }, { status: 500 });
  }

  // ── 5. Generate signed download URL (7 days) ──────────────────────
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days from now
  const token = await signDownloadToken(r2Key, expiresAt, env.DOWNLOAD_SIGNING_SECRET);

  const origin = new URL(request.url).origin;
  const downloadUrl = `${origin}/api/download/${encodeURIComponent(r2Key)}?token=${token}&expires=${expiresAt}`;

  return Response.json({
    success: true,
    downloadUrl,
    fileId: r2Key,
  });
};
