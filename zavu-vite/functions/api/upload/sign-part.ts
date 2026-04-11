import {
  assertOwnedFile,
  authenticateUser,
  CloudUploadEnv,
  createPresignedUploadPartUrl,
  parsePositiveInt,
} from '../_cloud-upload';

interface SignPartRequest {
  fileId?: unknown;
  uploadId?: unknown;
  partNumber?: unknown;
}

export const onRequestPost: PagesFunction<CloudUploadEnv> = async ({ request, env }) => {
  const user = await authenticateUser(request, env);
  if (user instanceof Response) return user;

  let body: SignPartRequest;
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const fileId = typeof body.fileId === 'string' ? body.fileId : '';
  const uploadId = typeof body.uploadId === 'string' ? body.uploadId : '';
  const partNumber =
    typeof body.partNumber === 'number'
      ? body.partNumber
      : parsePositiveInt(typeof body.partNumber === 'string' ? body.partNumber : null);

  if (!fileId || !uploadId || !partNumber) {
    return Response.json({ success: false, error: 'Missing multipart signing payload' }, { status: 400 });
  }
  if (partNumber > 10_000) {
    return Response.json({ success: false, error: 'Part number exceeds multipart upload limit' }, { status: 400 });
  }

  const ownedError = assertOwnedFile(user, fileId);
  if (ownedError) return ownedError;

  try {
    const presignedUrl = await createPresignedUploadPartUrl(env, fileId, uploadId, partNumber);
    return Response.json({
      success: true,
      presignedUrl,
    });
  } catch (error) {
    console.error('Presigned upload part generation failed:', error);
    return Response.json({ success: false, error: 'Presigned upload part generation failed' }, { status: 500 });
  }
};
