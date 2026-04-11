import {
  assertOwnedFile,
  authenticateUser,
  CloudUploadEnv,
} from '../_cloud-upload';

interface AbortUploadRequest {
  fileId?: unknown;
  uploadId?: unknown;
}

export const onRequestPost: PagesFunction<CloudUploadEnv> = async ({ request, env }) => {
  const user = await authenticateUser(request, env);
  if (user instanceof Response) return user;

  let body: AbortUploadRequest;
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const fileId = typeof body.fileId === 'string' ? body.fileId : '';
  const uploadId = typeof body.uploadId === 'string' ? body.uploadId : '';
  if (!fileId || !uploadId) {
    return Response.json({ success: false, error: 'Missing multipart abort payload' }, { status: 400 });
  }

  const ownedError = assertOwnedFile(user, fileId);
  if (ownedError) return ownedError;

  try {
    const multipart = env.ZAVU_BUCKET.resumeMultipartUpload(fileId, uploadId);
    await multipart.abort();
    await env.ZAVU_BUCKET.delete(fileId);
    return Response.json({ success: true });
  } catch (error) {
    console.error('Multipart upload abort failed:', error);
    return Response.json({ success: false, error: 'Multipart upload abort failed' }, { status: 500 });
  }
};
