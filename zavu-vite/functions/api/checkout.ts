import { verifyFirebaseJWT } from './_auth';

interface Env {
  FIREBASE_PROJECT_ID: string;
  LEMON_SQUEEZY_STORE_ID: string;
  LEMON_SQUEEZY_MONTHLY_VARIANT_ID?: string;
  LEMON_SQUEEZY_YEARLY_VARIANT_ID?: string;
  LEMON_SQUEEZY_PRO_VARIANT_ID?: string; // Backward compatibility
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const authHeader = request.headers.get('Authorization');
  console.log('Checkout request received:', { 
    hasAuth: !!authHeader, 
    envVars: {
      hasStoreId: !!env.LEMON_SQUEEZY_STORE_ID,
      hasMonthlyId: !!env.LEMON_SQUEEZY_MONTHLY_VARIANT_ID,
      hasYearlyId: !!env.LEMON_SQUEEZY_YEARLY_VARIANT_ID,
      hasProId: !!env.LEMON_SQUEEZY_PRO_VARIANT_ID
    }
  });

  // Test logging for debugging environment variables
  console.log('=== ENVIRONMENT VARIABLES DEBUG ===');
  console.log('LEMON_SQUEEZY_STORE_ID:', env.LEMON_SQUEEZY_STORE_ID);
  console.log('LEMON_SQUEEZY_MONTHLY_VARIANT_ID:', env.LEMON_SQUEEZY_MONTHLY_VARIANT_ID);
  console.log('LEMON_SQUEEZY_YEARLY_VARIANT_ID:', env.LEMON_SQUEEZY_YEARLY_VARIANT_ID);
  console.log('LEMON_SQUEEZY_PRO_VARIANT_ID:', env.LEMON_SQUEEZY_PRO_VARIANT_ID);
  console.log('FIREBASE_PROJECT_ID:', env.FIREBASE_PROJECT_ID);
  console.log('=== END DEBUG ===');
  
  if (!authHeader?.startsWith('Bearer ')) {
    console.error('Missing or invalid authorization header');
    return Response.json({ success: false, error: 'Missing authorization token' }, { status: 401 });
  }

  const user = await verifyFirebaseJWT(authHeader.slice(7), env.FIREBASE_PROJECT_ID);
  if (!user) {
    console.error('Firebase token verification failed');
    return Response.json({ success: false, error: 'Invalid or expired token' }, { status: 401 });
  }

  // Check for required environment variables
  if (!env.LEMON_SQUEEZY_STORE_ID) {
    console.error('Missing LEMON_SQUEEZY_STORE_ID');
    return Response.json({ success: false, error: 'Checkout is not configured - missing store ID' }, { status: 500 });
  }

  // Parse request body to get plan selection
  let plan = 'monthly'; // default
  try {
    const body = await request.json() as { plan?: string };
    plan = body.plan || 'monthly';
    console.log('Plan parsed from request body:', plan);
  } catch (error) {
    console.error('Failed to parse request body:', error);
    // If body parsing fails, use default monthly plan
  }

  // Select variant based on plan and available environment variables
  let variantId: string;
  
  console.log('Available environment variables:', {
    monthlyId: env.LEMON_SQUEEZY_MONTHLY_VARIANT_ID,
    yearlyId: env.LEMON_SQUEEZY_YEARLY_VARIANT_ID,
    proId: env.LEMON_SQUEEZY_PRO_VARIANT_ID
  });
  
  if (env.LEMON_SQUEEZY_MONTHLY_VARIANT_ID && env.LEMON_SQUEEZY_YEARLY_VARIANT_ID) {
    // New configuration with separate monthly/yearly variants
    variantId = plan === 'yearly' 
      ? env.LEMON_SQUEEZY_YEARLY_VARIANT_ID 
      : env.LEMON_SQUEEZY_MONTHLY_VARIANT_ID;
    console.log('Using new variant configuration:', { plan, variantId });
  } else if (env.LEMON_SQUEEZY_PRO_VARIANT_ID) {
    // Backward compatibility - use single variant for both plans
    variantId = env.LEMON_SQUEEZY_PRO_VARIANT_ID;
    console.log('Using fallback variant configuration:', { plan, variantId });
  } else {
    console.error('No variant IDs configured in environment');
    return Response.json({ 
      success: false, 
      error: 'Checkout variants not configured - missing variant IDs' 
    }, { status: 500 });
  }

  const baseUrl = `https://${env.LEMON_SQUEEZY_STORE_ID}.lemonsqueezy.com/checkout/buy/${variantId}`;
  const checkoutUrl = `${baseUrl}?checkout[custom][user_id]=${encodeURIComponent(user.uid)}`;

  console.log('=== CHECKOUT URL DEBUG ===');
  console.log('Store ID:', env.LEMON_SQUEEZY_STORE_ID);
  console.log('Variant ID:', variantId);
  console.log('Base URL:', baseUrl);
  console.log('Full checkout URL:', checkoutUrl);
  console.log('User ID:', user.uid);
  console.log('=== END URL DEBUG ===');

  return Response.json({
    success: true,
    checkoutUrl,
  });
};
