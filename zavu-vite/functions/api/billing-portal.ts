import { verifyFirebaseJWT } from './_auth';

interface Env {
  FIREBASE_PROJECT_ID: string;
  STRIPE_SECRET_KEY: string;
}

interface StripeCustomer {
  id: string;
  email?: string | null;
  created?: number;
}

interface StripeListResponse<T> {
  data?: T[];
  error?: {
    message?: string;
  };
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

  const customer = await findStripeCustomerByEmail(user.email, env.STRIPE_SECRET_KEY);
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

  const stripeResponse = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const stripeResult = await stripeResponse.json() as { url?: string; error?: { message?: string } };
  if (!stripeResponse.ok || !stripeResult.url) {
    return Response.json(
      {
        success: false,
        error: stripeResult.error?.message || 'Unable to open billing portal',
      },
      { status: 500 }
    );
  }

  return Response.json({ success: true, url: stripeResult.url });
};

async function findStripeCustomerByEmail(email: string, secretKey: string): Promise<StripeCustomer | null> {
  const response = await fetch(`https://api.stripe.com/v1/customers?email=${encodeURIComponent(email)}&limit=100`, {
    headers: {
      Authorization: `Bearer ${secretKey}`,
    },
  });

  const result = await response.json() as StripeListResponse<StripeCustomer>;
  if (!response.ok) {
    throw new Error(result.error?.message || 'Unable to search Stripe customers');
  }

  const matches = (result.data || []).filter(customer => customer.email?.toLowerCase() === email.toLowerCase());
  if (matches.length === 0) {
    return null;
  }

  matches.sort((a, b) => (b.created || 0) - (a.created || 0));
  return matches[0] || null;
}
