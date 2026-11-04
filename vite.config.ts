import { defineConfig } from 'vite';

export default defineConfig({
  server: { proxy: { '/api/geo': { target: 'http://127.0.0.1:8787', timeout: 600000, proxyTimeout: 600000 } } },
  preview: { proxy: { '/api/geo': { target: 'http://127.0.0.1:8787', timeout: 600000, proxyTimeout: 600000 } } },
});
