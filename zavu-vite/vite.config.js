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
            checkoutUrl: 'https://331412.lemonsqueezy.com/checkout/buy/1529390'
          }));
          return;
        }
        next();
      });
    }
  }
})
