interface Env {
  ZAVU_BUCKET: R2Bucket;
  CLEANUP_API_TOKEN?: string;
}

const DEFAULT_CLEANUP_BATCH_SIZE = 100;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.CLEANUP_API_TOKEN) {
    return Response.json({ success: false, error: 'Cleanup API token is not configured' }, { status: 500 });
  }

  const authToken = request.headers.get('X-Cleanup-Token');
  if (authToken !== env.CLEANUP_API_TOKEN) {
    return Response.json({ success: false, error: 'Unauthorized cleanup request' }, { status: 401 });
  }

  const url = new URL(request.url);
  const cursor = url.searchParams.get('cursor') || undefined;
  const limit = clampBatchSize(url.searchParams.get('limit'));
  const now = Date.now();

  const listed = await env.ZAVU_BUCKET.list({ cursor, limit });
  const expiredKeys: string[] = [];

  for (const object of listed.objects) {
    const head = await env.ZAVU_BUCKET.head(object.key);
    const expiresAt = Number.parseInt(head?.customMetadata?.expiresAt || '', 10);
    if (Number.isFinite(expiresAt) && expiresAt <= now) {
      expiredKeys.push(object.key);
    }
  }

  if (expiredKeys.length > 0) {
    await env.ZAVU_BUCKET.delete(expiredKeys);
  }

  return Response.json({
    success: true,
    scannedCount: listed.objects.length,
    deletedCount: expiredKeys.length,
    truncated: listed.truncated,
    cursor: listed.cursor ?? null,
  });
};

function clampBatchSize(rawLimit: string | null): number {
  const parsed = Number.parseInt(rawLimit || '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_CLEANUP_BATCH_SIZE;
  return Math.min(parsed, 1000);
}
