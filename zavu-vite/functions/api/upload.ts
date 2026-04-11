/**
 * POST /api/upload
 *
 * Creates a multipart upload session for a Pro user.
 * The browser then uploads bounded parts through /api/upload/part and
 * finalizes the object via /api/upload/complete.
 */
import {
  authenticateUser,
  CloudUploadEnv,
  computePartSize,
  getMultipartLimits,
  normalizeFileName,
} from './_cloud-upload';

interface CreateUploadRequest {
  fileName?: unknown;
  fileSize?: unknown;
}

export const onRequestPost: PagesFunction<CloudUploadEnv> = async ({ request, env }) => {
  const user = await authenticateUser(request, env, true);
  if (user instanceof Response) return user;

  let body: CreateUploadRequest;
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const fileName = normalizeFileName(typeof body.fileName === 'string' ? body.fileName : '');
  const fileSize = typeof body.fileSize === 'number' ? body.fileSize : NaN;
  if (!fileName) {
    return Response.json({ success: false, error: 'Missing file name' }, { status: 400 });
  }
  if (!Number.isFinite(fileSize) || fileSize < 0) {
    return Response.json({ success: false, error: 'Invalid file size' }, { status: 400 });
  }

  const { maxUploadBytes, maxPartBytes } = getMultipartLimits(env);
  if (fileSize > maxUploadBytes) {
    return Response.json({ success: false, error: 'File exceeds the cloud upload limit' }, { status: 413 });
  }

  const partSize = computePartSize(fileSize, maxPartBytes);
  if (!partSize) {
    return Response.json({ success: false, error: 'File requires upload parts larger than the configured limit' }, { status: 413 });
  }

  const fileId = `${user.uid}/${crypto.randomUUID()}/${fileName}`;
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const multipart = await env.ZAVU_BUCKET.createMultipartUpload(fileId, {
    httpMetadata: {
      contentType: 'application/octet-stream',
    },
    customMetadata: {
      originalName: fileName,
      uploadedBy: user.uid,
      uploadedAt: new Date().toISOString(),
      expiresAt: expiresAt.toString(),
    },
  });

  return Response.json({
    success: true,
    fileId,
    uploadId: multipart.uploadId,
    expiresAt,
    partSize,
  });
};
