import { verifyFirebaseJWT } from './_auth';

interface Env {
  ZAVU_BUCKET: R2Bucket;
  FIREBASE_PROJECT_ID: string;
}

interface DeleteRequestBody {
  fileIds?: unknown;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return Response.json({ success: false, error: 'Missing authorization token' }, { status: 401 });
  }

  const user = await verifyFirebaseJWT(authHeader.slice(7), env.FIREBASE_PROJECT_ID);
  if (!user) {
    return Response.json({ success: false, error: 'Invalid or expired token' }, { status: 401 });
  }

  let body: DeleteRequestBody;
  try {
    body = await request.json();
  } catch {
    return Response.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const fileIds = Array.isArray(body.fileIds) ? body.fileIds.filter((id): id is string => typeof id === 'string') : [];
  if (fileIds.length === 0) {
    return Response.json({ success: false, error: 'No file IDs provided' }, { status: 400 });
  }

  if (fileIds.length > 100) {
    return Response.json({ success: false, error: 'Too many file IDs in one request' }, { status: 400 });
  }

  const prefix = `${user.uid}/`;
  const ownedFileIds = fileIds.filter((fileId) => fileId.startsWith(prefix));
  if (ownedFileIds.length !== fileIds.length) {
    return Response.json({ success: false, error: 'Cannot delete files owned by another user' }, { status: 403 });
  }

  await env.ZAVU_BUCKET.delete(ownedFileIds);

  return Response.json({
    success: true,
    deletedCount: ownedFileIds.length,
  });
};
