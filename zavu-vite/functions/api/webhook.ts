import { setProStatus } from './_firebase-admin';

interface Env {
  FIREBASE_PROJECT_ID: string;
  STRIPE_WEBHOOK_SECRET: string;
  FIREBASE_SERVICE_ACCOUNT_KEY: string;
}

interface StripeEvent {
  id: string;
  type: string;
  data: {
    object: Record<string, unknown>;
  };
}

interface StripeMetadataCarrier {
  client_reference_id?: string | null;
  metadata?: Record<string, unknown> | null;
}

interface StripeCheckoutSession extends StripeMetadataCarrier {
  mode?: string;
  payment_status?: string;
}

interface StripeSubscription extends StripeMetadataCarrier {
  status: string;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const signature = request.headers.get('Stripe-Signature');
    if (!signature) {
      console.error('Missing webhook signature');
      return new Response('Invalid signature', { status: 401 });
    }

    const body = await request.text();
    const isValid = await verifyStripeSignature(body, signature, env.STRIPE_WEBHOOK_SECRET);
    if (!isValid) {
      console.error('Invalid webhook signature');
      return new Response('Invalid signature', { status: 401 });
    }

    const event = JSON.parse(body) as StripeEvent;
    console.log('Webhook event received:', event.type);

    switch (event.type) {
      case 'checkout.session.completed':
        await handleSuccessfulPayment(event, env);
        break;
      case 'customer.subscription.updated':
        await handleSubscriptionUpdate(event, env);
        break;
      case 'customer.subscription.deleted':
        await handleSubscriptionCancellation(event, env);
        break;
      default:
        console.log('Unhandled webhook event:', event.type);
    }

    return new Response('OK', { status: 200 });
  } catch (error) {
    console.error('Webhook error:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
};

async function handleSuccessfulPayment(event: StripeEvent, env: Env) {
  const session = event.data.object as StripeCheckoutSession;
  const userId = getUserIdFromMetadata(session);
  if (!userId) {
    console.error('No user_id found in Stripe checkout session metadata');
    return;
  }

  if (session.payment_status && session.payment_status !== 'paid' && session.mode !== 'subscription') {
    console.log('Payment not completed, payment_status:', session.payment_status);
    return;
  }

  console.log(`Granting Pro status to user: ${userId}`);
  await setProStatus(userId, true, env);
}

async function handleSubscriptionUpdate(event: StripeEvent, env: Env) {
  const subscription = event.data.object as StripeSubscription;
  const userId = getUserIdFromMetadata(subscription);
  if (!userId) {
    console.error('No user_id found in Stripe subscription metadata');
    return;
  }

  const isActive = ['active', 'trialing', 'past_due'].includes(subscription.status);
  console.log(`Updating Pro status for user ${userId}: ${isActive}`);
  await setProStatus(userId, isActive, env);
}

async function handleSubscriptionCancellation(event: StripeEvent, env: Env) {
  const subscription = event.data.object as StripeSubscription;
  const userId = getUserIdFromMetadata(subscription);
  if (!userId) {
    console.error('No user_id found in Stripe subscription metadata');
    return;
  }

  console.log(`Revoking Pro status for user: ${userId}`);
  await setProStatus(userId, false, env);
}

async function verifyStripeSignature(body: string, signatureHeader: string, secret: string): Promise<boolean> {
  const parsed = parseStripeSignature(signatureHeader);
  if (!parsed.timestamp || parsed.v1.length === 0) {
    return false;
  }

  const ageInSeconds = Math.abs(Math.floor(Date.now() / 1000) - parsed.timestamp);
  if (ageInSeconds > 300) {
    console.error('Stripe webhook signature timestamp is outside tolerance');
    return false;
  }

  const payload = `${parsed.timestamp}.${body}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const expected = bufferToHex(signature);

  return parsed.v1.some(candidate => timingSafeEqual(candidate, expected));
}

function parseStripeSignature(header: string): { timestamp: number | null; v1: string[] } {
  const parsed = { timestamp: null as number | null, v1: [] as string[] };

  for (const part of header.split(',')) {
    const [key, value] = part.split('=', 2);
    if (key === 't') {
      parsed.timestamp = Number(value);
    } else if (key === 'v1' && value) {
      parsed.v1.push(value);
    }
  }

  return parsed;
}

function getUserIdFromMetadata(object: StripeMetadataCarrier): string | null {
  const metadataUserId = object.metadata?.user_id;
  if (typeof metadataUserId === 'string' && metadataUserId.length > 0) {
    return metadataUserId;
  }

  if (typeof object.client_reference_id === 'string' && object.client_reference_id.length > 0) {
    return object.client_reference_id;
  }

  return null;
}

function bufferToHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
