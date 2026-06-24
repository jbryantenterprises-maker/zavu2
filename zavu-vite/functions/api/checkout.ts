import { verifyFirebaseJWT } from './_auth';
import {
  createStripeCustomerForUser,
  findStripeCustomerForUser,
  stripeErrorMessage,
  stripePost,
} from './_stripe';

interface Env {
  FIREBASE_PROJECT_ID: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_MONTHLY_PRICE_ID?: string;
  STRIPE_YEARLY_PRICE_ID?: string;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    console.error('Missing or invalid authorization header');
    return Response.json({ success: false, error: 'Missing authorization token' }, { status: 401 });
  }

  const user = await verifyFirebaseJWT(authHeader.slice(7), env.FIREBASE_PROJECT_ID);
  if (!user) {
    console.error('Firebase token verification failed');
    return Response.json({ success: false, error: 'Invalid or expired token' }, { status: 401 });
  }

  if (!env.STRIPE_SECRET_KEY) {
    console.error('Missing STRIPE_SECRET_KEY');
    return Response.json({ success: false, error: 'Checkout is not configured' }, { status: 500 });
  }

  let plan: 'monthly' | 'yearly' = 'monthly';
  try {
    const body = await request.json() as { plan?: 'monthly' | 'yearly' };
    if (body.plan === 'yearly') {
      plan = 'yearly';
    }
  } catch (error) {
    console.error('Failed to parse request body:', error);
  }

  const priceId = plan === 'yearly' ? env.STRIPE_YEARLY_PRICE_ID : env.STRIPE_MONTHLY_PRICE_ID;
  if (!priceId) {
    console.error(`Missing Stripe price ID for plan: ${plan}`);
    return Response.json({ success: false, error: `Checkout plan "${plan}" is not configured` }, { status: 500 });
  }

  const origin = new URL(request.url).origin;
  let stripeCustomer;
  try {
    stripeCustomer = await findStripeCustomerForUser(user.uid, user.email, env.STRIPE_SECRET_KEY)
      || await createStripeCustomerForUser(user.uid, user.email, env.STRIPE_SECRET_KEY);
  } catch (error) {
    console.error('Stripe customer lookup/create failed:', error);
    return Response.json({ success: false, error: 'Unable to prepare Stripe customer' }, { status: 502 });
  }

  const formData = new URLSearchParams({
    mode: 'subscription',
    success_url: `${origin}/?checkout=success`,
    cancel_url: `${origin}/?checkout=cancelled`,
    customer: stripeCustomer.id,
    client_reference_id: user.uid,
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    'metadata[user_id]': user.uid,
    'metadata[plan]': plan,
    'subscription_data[metadata][user_id]': user.uid,
    'subscription_data[metadata][firebase_uid]': user.uid,
    'subscription_data[metadata][plan]': plan,
    'customer_update[name]': 'auto',
    'customer_update[address]': 'auto',
    allow_promotion_codes: 'true',
  });

  let stripeResponse: Response;
  let stripeResult: { url?: string; error?: { message?: string } };
  try {
    const result = await stripePost<{ url?: string }>('checkout/sessions', env.STRIPE_SECRET_KEY, formData);
    stripeResponse = result.response;
    stripeResult = result.result;
  } catch (error) {
    console.error('Stripe checkout request failed:', error);
    return Response.json({ success: false, error: 'Unable to reach Stripe checkout' }, { status: 502 });
  }

  if (!stripeResponse.ok || !stripeResult.url) {
    console.error('Stripe checkout session creation failed:', stripeResult);
    return Response.json(
      {
        success: false,
        error: stripeErrorMessage(stripeResult, 'Unable to create checkout session'),
      },
      { status: 500 }
    );
  }

  return Response.json({
    success: true,
    checkoutUrl: stripeResult.url,
  });
};
