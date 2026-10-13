import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { cpSync, existsSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, resolve } from 'node:path';

// Two targets from one codebase:
//   vite build              → dist/      Chrome extension (manifest, background worker)
//   vite build --mode web   → dist-web/  installable local web app (PWA, works offline)

/** Copy the pdf.js runtime assets (fonts, cmaps, wasm decoders) next to the build. */
function copyPdfjsAssets(): Plugin {
  return {
    name: 'copy-pdfjs-assets',
    apply: 'build',
    writeBundle(opts) {
      const out = opts.dir ?? 'dist';
      for (const dir of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
        const src = resolve('node_modules/pdfjs-dist', dir);
        if (existsSync(src)) cpSync(src, resolve(out, 'pdfjs', dir), { recursive: true });
      }
    },
  };
}

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? listFiles(p) : [p];
  });
}

/** Web target: serve the app as index.html, add a web manifest and an offline service worker. */
function webApp(): Plugin {
  return {
    name: 'web-app',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'link', attrs: { rel: 'manifest', href: 'manifest.webmanifest' }, injectTo: 'head' },
      { tag: 'meta', attrs: { name: 'theme-color', content: '#5b5bd6' }, injectTo: 'head' },
      { tag: 'link', attrs: { rel: 'apple-touch-icon', href: 'icons/icon192.png' }, injectTo: 'head' },
    ],
    writeBundle(opts) {
      const out = opts.dir!;
      renameSync(join(out, 'app.html'), join(out, 'index.html'));
      cpSync(resolve('public/icons'), join(out, 'icons'), { recursive: true });

      writeFileSync(
        join(out, 'manifest.webmanifest'),
        JSON.stringify(
          {
            name: 'Autofill My PDF',
            short_name: 'Autofill PDF',
            description: 'Enter your info once. Map it onto any PDF, then fill, sign, save and print.',
            start_url: './',
            scope: './',
            display: 'standalone',
            background_color: '#0c0e13',
            theme_color: '#5b5bd6',
            icons: [
              { src: 'icons/icon192.png', sizes: '192x192', type: 'image/png' },
              { src: 'icons/icon512.png', sizes: '512x512', type: 'image/png' },
              { src: 'icons/icon512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
            ],
            file_handlers: [{ action: './', accept: { 'application/pdf': ['.pdf'] } }],
          },
          null,
          2,
        ),
      );

      // Precache the app shell; pdf.js fonts/cmaps are cached the first time they're needed.
      const files = listFiles(out)
        .map((f) => relative(out, f).replace(/\\/g, '/'))
        .filter((f) => !f.startsWith('pdfjs/') && f !== 'sw.js');
      const hash = createHash('sha1');
      for (const f of files) hash.update(f + statSync(join(out, f)).size);
      const version = hash.digest('hex').slice(0, 10);
      writeFileSync(
        join(out, 'sw.js'),
        `// Generated at build time. Serves the app from cache so it opens even when the local server isn't running.
const CACHE = 'afp-${version}';
const PRECACHE = ${JSON.stringify(['./', ...files])};
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('afp-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const key = req.mode === 'navigate' ? './' : req;
  e.respondWith(
    caches.open(CACHE).then(async (c) => {
      const hit = await c.match(key, { ignoreSearch: req.mode === 'navigate', ignoreVary: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && new URL(req.url).pathname.includes('/pdfjs/')) c.put(req, res.clone());
      return res;
    }),
  );
});
`,
      );
    },
  };
}

export default defineConfig(({ mode }) => {
  const web = mode === 'web';
  const input: Record<string, string> = { app: resolve(import.meta.dirname, 'app.html') };
  if (!web) input.background = resolve(import.meta.dirname, 'src/background.ts');
  return {
    base: './',
    publicDir: web ? false : 'public',
    plugins: [react(), copyPdfjsAssets(), ...(web ? [webApp()] : [])],
    define: { __TARGET__: JSON.stringify(web ? 'web' : 'extension') },
    worker: { format: 'es' },
    server: { port: 4517, strictPort: true, open: '/app.html' },
    preview: { port: 4517, strictPort: true, open: '/' },
    build: {
      outDir: web ? 'dist-web' : 'dist',
      emptyOutDir: true,
      target: 'chrome120',
      sourcemap: mode === 'development',
      minify: mode !== 'development',
      chunkSizeWarningLimit: 2500,
      rolldownOptions: {
        input,
        output: {
          entryFileNames: (chunk) => (chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js'),
        },
      },
    },
  };
});
