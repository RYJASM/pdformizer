import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { cpSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

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

export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), copyPdfjsAssets()],
  worker: { format: 'es' },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome120',
    sourcemap: mode === 'development',
    minify: mode !== 'development',
    chunkSizeWarningLimit: 2500,
    rolldownOptions: {
      input: {
        app: resolve(import.meta.dirname, 'app.html'),
        background: resolve(import.meta.dirname, 'src/background.ts'),
      },
      output: {
        entryFileNames: (chunk) => (chunk.name === 'background' ? 'background.js' : 'assets/[name]-[hash].js'),
      },
    },
  },
}));
