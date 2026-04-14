interface Env {
  FIREBASE_PROJECT_ID: string;
  LEMON_SQUEEZY_WEBHOOK_SECRET: string;
  FIREBASE_SERVICE_ACCOUNT_KEY: string;
}

// Helper function to convert hex string to Uint8Array
function hexToUint8Array(hex: string): Uint8Array {
  const result = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    result[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return result;
}

interface LemonSqueezyWebhookEvent {
  data: {
    type: string;
    id: string;
    attributes: {
      status: string;
      order_id: number;
      product_id: number;
      variant_id: number;
      user_id?: string;
      customer_email: string;
      created_at: string;
      updated_at: string;
    };
  };
  meta: {
    event_name: string;
    custom_data?: {
      user_id?: string;
    };
  };
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    // Verify webhook signature
    const signature = request.headers.get('X-Lemon-Squeezy-Signature');
    if (!signature) {
      console.error('Missing webhook signature');
      return new Response('Invalid signature', { status: 401 });
    }

    const body = await request.text();
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(env.LEMON_SQUEEZY_WEBHOOK_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const isValid = await crypto.subtle.verify(
      'HMAC',
      cryptoKey,
      hexToUint8Array(signature),
      new TextEncoder().encode(body)
    );

    if (!isValid) {
      console.error('Invalid webhook signature');
      return new Response('Invalid signature', { status: 401 });
    }

    const event: LemonSqueezyWebhookEvent = JSON.parse(body);
    console.log('Webhook event received:', event.meta.event_name);

    // Handle different event types
    switch (event.meta.event_name) {
      case 'order_created':
      case 'subscription_created':
        await handleSuccessfulPayment(event, env);
        break;

      case 'subscription_updated':
        await handleSubscriptionUpdate(event, env);
        break;

      case 'subscription_cancelled':
      case 'subscription_expired':
        await handleSubscriptionCancellation(event, env);
        break;

      default:
        console.log('Unhandled webhook event:', event.meta.event_name);
    }

    return new Response('OK', { status: 200 });

  } catch (error) {
    console.error('Webhook error:', error);
    return new Response('Internal Server Error', { status: 500 });
  }
};

async function handleSuccessfulPayment(event: LemonSqueezyWebhookEvent, env: Env) {
  const userId = event.meta.custom_data?.user_id;
  
  if (!userId) {
    console.error('No user_id found in webhook custom data');
    return;
  }

  // Only grant Pro status for successful payments
  if (event.data.attributes.status !== 'paid') {
    console.log('Payment not completed, status:', event.data.attributes.status);
    return;
  }

  console.log(`Granting Pro status to user: ${userId}`);
  await setProStatus(userId, true, env);
}

async function handleSubscriptionUpdate(event: LemonSqueezyWebhookEvent, env: Env) {
  const userId = event.meta.custom_data?.user_id;
  
  if (!userId) {
    console.error('No user_id found in webhook custom data');
    return;
  }

  // Check if subscription is still active
  const isActive = event.data.attributes.status === 'active';
  console.log(`Updating Pro status for user ${userId}: ${isActive}`);
  await setProStatus(userId, isActive, env);
}

async function handleSubscriptionCancellation(event: LemonSqueezyWebhookEvent, env: Env) {
  const userId = event.meta.custom_data?.user_id;
  
  if (!userId) {
    console.error('No user_id found in webhook custom data');
    return;
  }

  console.log(`Revoking Pro status for user: ${userId}`);
  await setProStatus(userId, false, env);
}

async function setProStatus(userId: string, isPro: boolean, env: Env) {
  try {
    // Get Firebase Admin SDK service account key from environment
    const serviceAccountKey = env.FIREBASE_SERVICE_ACCOUNT_KEY;
    if (!serviceAccountKey) {
      console.error('Missing FIREBASE_SERVICE_ACCOUNT_KEY environment variable');
      return;
    }

    // Parse service account key
    const serviceAccount = JSON.parse(serviceAccountKey);
    
    // Get Firebase ID token
    const token = await getFirebaseAccessToken(serviceAccount);
    
    // Set custom claim
    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/accounts:update`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          localId: userId,
          customAttributes: JSON.stringify({ pro: isPro }),
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error('Failed to set custom claim:', error);
      return;
    }

    console.log(`Successfully ${isPro ? 'granted' : 'revoked'} Pro status for user: ${userId}`);

  } catch (error) {
    console.error('Error setting Pro status:', error);
  }
}

async function getFirebaseAccessToken(serviceAccount: any): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const expiry = now + 3600; // 1 hour

  const header = {
    alg: 'RS256',
    typ: 'JWT',
    kid: serviceAccount.private_key_id,
  };

  const payload = {
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.auth',
    aud: 'https://www.googleapis.com/oauth2/v4/token',
    exp: expiry,
    iat: now,
  };

  // Create JWT
  const token = await createJWT(header, payload, serviceAccount.private_key);

  // Exchange for access token
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: token,
    }),
  });

  const result = await response.json() as { access_token: string };
  return result.access_token;
}

async function createJWT(header: any, payload: any, privateKey: string): Promise<string> {
  const encoder = new TextEncoder();
  
  // Encode header and payload
  const headerBase64 = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const payloadBase64 = btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  
  // Create signature
  const data = `${headerBase64}.${payloadBase64}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    new TextEncoder().encode(privateKey.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\n/g, '')),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(data));
  const signatureBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  
  return `${data}.${signatureBase64}`;
}
