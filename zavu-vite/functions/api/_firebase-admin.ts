import { importPKCS8, SignJWT } from 'jose';

interface Env {
  FIREBASE_PROJECT_ID: string;
  FIREBASE_SERVICE_ACCOUNT_KEY: string;
}

interface FirebaseServiceAccount {
  client_email: string;
  private_key: string;
  private_key_id?: string;
}

export async function setProStatus(userId: string, isPro: boolean, env: Env): Promise<void> {
  const serviceAccountKey = env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!serviceAccountKey) {
    console.error('Missing FIREBASE_SERVICE_ACCOUNT_KEY environment variable');
    return;
  }

  try {
    const serviceAccount = JSON.parse(serviceAccountKey) as FirebaseServiceAccount;
    const token = await getFirebaseAccessToken(serviceAccount);

    const response = await fetch(
      `https://identitytoolkit.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/accounts:update`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          localId: userId,
          customAttributes: JSON.stringify({ pro: isPro }),
        }),
      }
    );

    if (!response.ok) {
      console.error('Failed to set Firebase custom claims:', await response.text());
      return;
    }

    console.log(`Successfully ${isPro ? 'granted' : 'revoked'} Pro status for user ${userId}`);
  } catch (error) {
    console.error('Error setting Firebase custom claims:', error);
  }
}

async function getFirebaseAccessToken(serviceAccount: FirebaseServiceAccount): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const privateKey = await importPKCS8(serviceAccount.private_key, 'RS256');

  const assertion = await new SignJWT({
    scope: 'https://www.googleapis.com/auth/firebase.auth',
  })
    .setProtectedHeader({
      alg: 'RS256',
      typ: 'JWT',
      kid: serviceAccount.private_key_id,
    })
    .setIssuer(serviceAccount.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + 3600)
    .sign(privateKey);

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to get Firebase access token: ${await response.text()}`);
  }

  const result = await response.json() as { access_token?: string };
  if (!result.access_token) {
    throw new Error('Firebase access token response missing access_token');
  }

  return result.access_token;
}
