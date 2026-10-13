// Which build is running: the Chrome extension or the installable local web app.
declare const __TARGET__: 'extension' | 'web';

export const IS_WEB = __TARGET__ === 'web';

interface LaunchParams {
  files: { getFile(): Promise<File> }[];
}
declare global {
  interface Window {
    launchQueue?: { setConsumer(cb: (p: LaunchParams) => void): void };
  }
}

/** Web build: offline cache, durable storage, and "Open with" for PDFs once installed. */
export function initWebApp(onFiles: (files: File[]) => void) {
  if (!IS_WEB) return;
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    window.addEventListener('load', () => void navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('[autofill] service worker', e)));
  }
  // Without this the browser may evict IndexedDB (your PDFs and data) when disk space runs low.
  void navigator.storage?.persist?.().catch(() => {});
  window.launchQueue?.setConsumer(async (params) => {
    const files = await Promise.all(params.files.map((h) => h.getFile()));
    const pdfs = files.filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (pdfs.length) onFiles(pdfs);
  });
}

// PDFs handed to the app by the OS wait here until the Fill screen picks them up.
let pending: File[] = [];
const listeners = new Set<() => void>();
export function queueLaunchFiles(files: File[]) {
  pending = [...pending, ...files];
  listeners.forEach((l) => l());
}
export function takeLaunchFiles(): File[] {
  const f = pending;
  pending = [];
  return f;
}
export function onLaunchFiles(cb: () => void) {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}
