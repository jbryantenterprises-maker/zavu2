// Mock checkout endpoint for local development
// Add this to your vite.config.js or run with Vite's server middleware

export function mockCheckoutMiddleware() {
  return (req, res, next) => {
    if (req.url === '/api/checkout' && req.method === 'POST') {
      // Mock successful checkout response
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        success: true,
        checkoutUrl: 'https://331412.lemonsqueezy.com/checkout/buy/1529390'
      }));
      return;
    }
    next();
  };
}
