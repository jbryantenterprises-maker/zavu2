/**
 * Global middleware for Pages Functions.
 * Handles CORS preflight for /api/* routes.
 */
interface Env {
  ALLOWED_ORIGINS?: string;
  CONTENT_SECURITY_POLICY?: string;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request } = context;

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request, context.env),
    });
  }

  // Process the actual request
  const response = await context.next();

  // Attach CORS headers to the response
  const newHeaders = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(request, context.env))) {
    newHeaders.set(key, value);
  }
  for (const [key, value] of Object.entries(securityHeaders(context.env))) {
    newHeaders.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders,
  });
};

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin');
  const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS);
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };

  if (origin && allowedOrigins.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  return headers;
}

function parseAllowedOrigins(rawOrigins?: string): Set<string> {
  return new Set(
    (rawOrigins || '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean)
  );
}

function securityHeaders(env: Env): Record<string, string> {
  return {
    'Content-Security-Policy': env.CONTENT_SECURITY_POLICY || defaultContentSecurityPolicy(),
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
  };
}

function defaultContentSecurityPolicy(): string {
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob:",
    "connect-src 'self' https://www.googleapis.com https://securetoken.googleapis.com https://identitytoolkit.googleapis.com https://*.googleapis.com wss: https:",
    "worker-src 'self' blob:",
    "media-src 'self' blob:",
  ].join('; ');
}
