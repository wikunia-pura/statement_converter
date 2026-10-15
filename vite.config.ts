import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * Content-Security-Policy of the packaged app. The renderer carries the full
 * `window.electronAPI`, so even if stored HTML ever got past the sanitizer, no
 * script of its own may run and nothing may be loaded from elsewhere:
 *   - scripts only from the bundle (no inline, no eval);
 *   - inline styles allowed — React's `style={…}` and the letters' inline CSS;
 *   - images from the bundle and `data:` (the letterhead, the CSS icons);
 *   - no frames, plugins or <base>: PDFs are previewed in a separate window.
 * The renderer makes no network calls of its own — Supabase and the AI run in
 * the main process — so `connect-src` stays at 'self'.
 *
 * Build only: the dev server's React refresh preamble is an inline script.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'filefunky-csp',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY },
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}

export default defineConfig({
  plugins: [react(), contentSecurityPolicy()],
  root: path.join(__dirname, 'src/renderer'),
  base: './',
  build: {
    outDir: path.join(__dirname, 'dist/renderer'),
    emptyOutDir: true,
  },
  server: {
    port: 3000,
  },
});
