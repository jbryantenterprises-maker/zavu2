export interface StripeErrorResponse {
  error?: {
    message?: string;
  };
}

export interface StripeCustomer {
  id: string;
  email?: string | null;
  created?: number;
  metadata?: Record<string, string>;
}

interface StripeListResponse<T> extends StripeErrorResponse {
  data?: T[];
}

export async function stripePost<T>(
  path: string,
  secretKey: string,
  body: URLSearchParams,
): Promise<{ response: Response; result: T & StripeErrorResponse }> {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const result = await response.json() as T & StripeErrorResponse;
  return { response, result };
}

export async function findStripeCustomerForUser(
  userId: string,
  email: string | undefined,
  secretKey: string,
): Promise<StripeCustomer | null> {
  const metadataMatch = await searchStripeCustomerByFirebaseUid(userId, secretKey).catch((error) => {
    console.warn('Stripe customer metadata search failed; falling back to email lookup:', error);
    return null;
  });
  if (metadataMatch) return metadataMatch;

  if (!email) return null;
  return findStripeCustomerByEmail(email, secretKey);
}

export async function createStripeCustomerForUser(
  userId: string,
  email: string | undefined,
  secretKey: string,
): Promise<StripeCustomer> {
  const body = new URLSearchParams({
    'metadata[firebase_uid]': userId,
  });

  if (email) {
    body.set('email', email);
  }

  const { response, result } = await stripePost<StripeCustomer>('customers', secretKey, body);
  if (!response.ok || !result.id) {
    throw new Error(stripeErrorMessage(result, 'Unable to create Stripe customer'));
  }

  return result;
}

export function stripeErrorMessage(
  result: StripeErrorResponse,
  fallback: string,
): string {
  return result.error?.message || fallback;
}

async function searchStripeCustomerByFirebaseUid(
  userId: string,
  secretKey: string,
): Promise<StripeCustomer | null> {
  const params = new URLSearchParams({
    query: `metadata['firebase_uid']:'${escapeStripeSearchValue(userId)}'`,
    limit: '1',
  });

  const response = await fetch(`https://api.stripe.com/v1/customers/search?${params.toString()}`, {
    headers: {
      Authorization: `Bearer ${secretKey}`,
    },
  });

  const result = await response.json() as StripeListResponse<StripeCustomer>;
  if (!response.ok) {
    throw new Error(stripeErrorMessage(result, 'Unable to search Stripe customers'));
  }

  return result.data?.[0] || null;
}

async function findStripeCustomerByEmail(email: string, secretKey: string): Promise<StripeCustomer | null> {
  const response = await fetch(`https://api.stripe.com/v1/customers?email=${encodeURIComponent(email)}&limit=100`, {
    headers: {
      Authorization: `Bearer ${secretKey}`,
    },
  });

  const result = await response.json() as StripeListResponse<StripeCustomer>;
  if (!response.ok) {
    throw new Error(stripeErrorMessage(result, 'Unable to list Stripe customers'));
  }

  const matches = (result.data || []).filter(customer => customer.email?.toLowerCase() === email.toLowerCase());
  if (matches.length === 0) return null;

  matches.sort((a, b) => (b.created || 0) - (a.created || 0));
  return matches[0] || null;
}

function escapeStripeSearchValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}
