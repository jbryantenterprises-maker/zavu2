import { verifyFirebaseJWT } from './_auth';

interface Env {
  FIREBASE_PROJECT_ID: string;
  STRIPE_SECRET_KEY: string;
  STRIPE_MONTHLY_PRICE_ID?: string;
  STRIPE_YEARLY_PRICE_ID?: string;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const authHeader = request.headers.get('Authorization');
  console.log('Checkout request received:', {
    hasAuth: !!authHeader,
    envVars: {
      hasStripeKey: !!env.STRIPE_SECRET_KEY,
      hasMonthlyPriceId: !!env.STRIPE_MONTHLY_PRICE_ID,
      hasYearlyPriceId: !!env.STRIPE_YEARLY_PRICE_ID,
    },
  });

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
  const formData = new URLSearchParams({
    mode: 'subscription',
    success_url: `${origin}/?checkout=success`,
    cancel_url: `${origin}/?checkout=cancelled`,
    client_reference_id: user.uid,
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    'metadata[user_id]': user.uid,
    'metadata[plan]': plan,
    'subscription_data[metadata][user_id]': user.uid,
    'subscription_data[metadata][plan]': plan,
    allow_promotion_codes: 'true',
  });

  if (user.email) {
    formData.set('customer_email', user.email);
  }

  const stripeResponse = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formData,
  });

  const stripeResult = await stripeResponse.json() as { url?: string; error?: { message?: string } };
  if (!stripeResponse.ok || !stripeResult.url) {
    console.error('Stripe checkout session creation failed:', stripeResult);
    return Response.json(
      {
        success: false,
        error: stripeResult.error?.message || 'Unable to create checkout session',
      },
      { status: 500 }
    );
  }

  return Response.json({
    success: true,
    checkoutUrl: stripeResult.url,
  });
};
