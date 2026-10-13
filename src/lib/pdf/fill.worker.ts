/// <reference lib="webworker" />
import { fillAndMerge, fillPdf, type FillJob } from './fill';

type Req = { id: number; type: 'fill'; job: FillJob } | { id: number; type: 'merge'; jobs: FillJob[] };

self.onmessage = async (e: MessageEvent<Req>) => {
  const msg = e.data;
  try {
    const bytes = msg.type === 'fill' ? await fillPdf(msg.job) : await fillAndMerge(msg.jobs);
    (self as unknown as Worker).postMessage({ id: msg.id, ok: true, bytes }, [bytes.buffer]);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
