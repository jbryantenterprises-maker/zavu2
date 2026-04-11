import {
  assertOwnedFile,
  authenticateUser,
  buildSignedDownload,
  CloudUploadEnv,
} from '../_cloud-upload';

interface CompleteUploadRequest {
  fileId?: unknown;
  uploadId?: unknown;
  parts?: unknown;
}

interface UploadedPartPayload {
  partNumber: number;
  etag: string;
}

export const onRequestPost: PagesFunction<CloudUploadEnv> = async ({ request, env }) => {
  const user = await authenticateUser(request, env);
  if (user instanceof Response) return user;

  let body: CompleteUploadRequest;
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const fileId = typeof body.fileId === 'string' ? body.fileId : '';
  const uploadId = typeof body.uploadId === 'string' ? body.uploadId : '';
  const parts = Array.isArray(body.parts)
    ? body.parts.filter(isUploadedPartPayload).sort((a, b) => a.partNumber - b.partNumber)
    : [];

  if (!fileId || !uploadId || parts.length === 0) {
    return Response.json({ success: false, error: 'Missing multipart completion payload' }, { status: 400 });
  }

  const ownedError = assertOwnedFile(user, fileId);
  if (ownedError) return ownedError;

  try {
    const multipart = env.ZAVU_BUCKET.resumeMultipartUpload(fileId, uploadId);
    const completedObject = await multipart.complete(parts);
    const expiresAt = Number.parseInt(completedObject.customMetadata?.expiresAt || '', 10);
    const signed = await buildSignedDownload(
      request,
      env,
      fileId,
      Number.isFinite(expiresAt) ? expiresAt : Date.now() + 7 * 24 * 60 * 60 * 1000,
    );

    return Response.json({
      success: true,
      fileId,
      downloadUrl: signed.downloadUrl,
      expiresAt: signed.expiresAt,
    });
  } catch (error) {
    console.error('Multipart upload completion failed:', error);
    return Response.json({ success: false, error: 'Multipart upload completion failed' }, { status: 500 });
  }
};

function isUploadedPartPayload(value: unknown): value is UploadedPartPayload {
  return !!value
    && typeof value === 'object'
    && typeof (value as UploadedPartPayload).partNumber === 'number'
    && typeof (value as UploadedPartPayload).etag === 'string';
}
