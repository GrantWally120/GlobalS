// Promise-based messaging with a module worker: call() awaits a reply, on() receives pushes.

export class WorkerClient {
  constructor(url) {
    this.worker = new Worker(url, { type: 'module' });
    this.seq = 0;
    this.pending = new Map();
    this.handlers = new Map();
    this.worker.onmessage = (e) => {
      const m = e.data;
      if (m.id !== undefined && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) reject(new Error(m.error));
        else resolve(m.data);
        return;
      }
      const fn = this.handlers.get(m.type);
      if (fn) fn(m);
    };
    this.worker.onerror = (e) => {
      const err = new Error(e.message || 'worker error');
      for (const { reject } of this.pending.values()) reject(err);
      this.pending.clear();
      this.handlers.get('fatal')?.({ message: err.message });
    };
  }

  call(type, payload = {}, transfer = []) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...payload, type, id }, transfer);
    });
  }

  post(type, payload = {}, transfer = []) {
    this.worker.postMessage({ ...payload, type }, transfer);
  }

  on(type, fn) {
    this.handlers.set(type, fn);
  }
}

/** Worker side: dispatch messages to handlers; each handler's return value is the reply. */
export function serve(handlers) {
  self.onmessage = async (e) => {
    const m = e.data;
    const fn = handlers[m.type];
    if (!fn) return;
    try {
      const out = await fn(m);
      if (m.id !== undefined) {
        const { data, transfer } = out && out.__transfer ? out : { data: out, transfer: [] };
        self.postMessage({ id: m.id, data }, transfer);
      }
    } catch (err) {
      if (m.id !== undefined) self.postMessage({ id: m.id, error: String(err?.message || err) });
      else self.postMessage({ type: 'error', message: String(err?.message || err) });
    }
  };
}

/** Wrap a reply whose ArrayBuffers should be transferred rather than copied. */
export const withTransfer = (data, transfer) => ({ __transfer: true, data, transfer });
