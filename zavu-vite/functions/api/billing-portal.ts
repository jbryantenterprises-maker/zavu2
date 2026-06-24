import { verifyFirebaseJWT } from './_auth';
import { findStripeCustomerForUser, stripeErrorMessage, stripePost } from './_stripe';

interface Env {
  FIREBASE_PROJECT_ID: string;
  STRIPE_SECRET_KEY: string;
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

  if (!env.STRIPE_SECRET_KEY) {
    return Response.json({ success: false, error: 'Billing portal is not configured' }, { status: 500 });
  }

  if (!user.email) {
    return Response.json({ success: false, error: 'Your account is missing an email address' }, { status: 400 });
  }

  const customer = await findStripeCustomerForUser(user.uid, user.email, env.STRIPE_SECRET_KEY);
  if (!customer) {
    return Response.json(
      { success: false, error: 'No Stripe customer found for this account yet' },
      { status: 404 }
    );
  }

  const origin = new URL(request.url).origin;
  const body = new URLSearchParams({
    customer: customer.id,
    return_url: `${origin}/?billing=returned`,
  });

  let stripeResponse: Response;
  let stripeResult: { url?: string; error?: { message?: string } };
  try {
    const result = await stripePost<{ url?: string }>('billing_portal/sessions', env.STRIPE_SECRET_KEY, body);
    stripeResponse = result.response;
    stripeResult = result.result;
  } catch (error) {
    console.error('Stripe billing portal request failed:', error);
    return Response.json({ success: false, error: 'Unable to reach Stripe billing portal' }, { status: 502 });
  }

  if (!stripeResponse.ok || !stripeResult.url) {
    return Response.json(
      {
        success: false,
        error: stripeErrorMessage(stripeResult, 'Unable to open billing portal'),
      },
      { status: 500 }
    );
  }

  return Response.json({ success: true, url: stripeResult.url });
};
