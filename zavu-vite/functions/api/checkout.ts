import { verifyFirebaseJWT } from './_auth';

interface Env {
  FIREBASE_PROJECT_ID: string;
  LEMON_SQUEEZY_STORE_ID: string;
  LEMON_SQUEEZY_PRO_VARIANT_ID: string;
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

  if (!env.LEMON_SQUEEZY_STORE_ID || !env.LEMON_SQUEEZY_PRO_VARIANT_ID) {
    return Response.json({ success: false, error: 'Checkout is not configured' }, { status: 500 });
  }

  const checkoutUrl =
    `https://${env.LEMON_SQUEEZY_STORE_ID}.lemonsqueezy.com/checkout/buy/${env.LEMON_SQUEEZY_PRO_VARIANT_ID}` +
    `?checkout[custom][user_id]=${encodeURIComponent(user.uid)}`;

  return Response.json({
    success: true,
    checkoutUrl,
  });
};
