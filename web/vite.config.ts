import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
// @ts-expect-error import from project root
import { handleSupportQuery } from '../supportGateway.js';

function supportApiPlugin(): Plugin {
  return {
    name: 'support-api-plugin',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ? req.url.split('?')[0] : '';
        if (url === '/api/support/query' && req.method === 'POST') {
          let body = '';
          req.on('data', (chunk: Buffer) => {
            body += chunk.toString();
          });
          req.on('end', async () => {
            try {
              const envelope = JSON.parse(body || '{}');
              const result = await handleSupportQuery(envelope);
              res.setHeader('Content-Type', 'application/json');
              res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
              res.statusCode = 200;
              res.end(JSON.stringify(result));
            } catch (err: unknown) {
              res.setHeader('Content-Type', 'application/json');
              res.statusCode = 400;
              const msg = err instanceof Error ? err.message : 'Support query failed.';
              res.end(JSON.stringify({ error: msg }));
            }
          });
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), supportApiPlugin()],
  server: {
    host: '0.0.0.0',
    port: 3000,
  },
});
