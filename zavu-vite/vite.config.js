import { defineConfig } from 'vite'

export default defineConfig({
  css: {
    postcss: './postcss.config.js',
  },
  server: {
    port: 5173,
    host: true,
    configureServer: (server) => {
      server.middlewares.use((req, res, next) => {
        if (req.url === '/api/checkout' && req.method === 'POST') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            success: true,
            checkoutUrl: 'https://checkout.stripe.com/c/pay/cs_test_mock_xavu_pro'
          }));
          return;
        }
        if (req.url === '/api/billing-portal' && req.method === 'POST') {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({
            success: true,
            url: 'https://billing.stripe.com/p/session/test_mock_xavu_pro'
          }));
          return;
        }
        next();
      });
    }
  }
})
