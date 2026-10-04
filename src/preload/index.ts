import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc';

/**
 * Sandboxed preload — exposes a narrow typed API. Each API method maps 1:1 to
 * an allowlisted IPC channel; responses are unwrapped (envelope {ok,data|error}).
 * No Node primitives leak into the renderer.
 */
interface WireError {
  code?: string;
  message?: string;
  correlationId?: string;
  details?: unknown;
}

function unwrap<T>(res: { ok: true; data: T } | { ok: false; error: WireError }): T {
  if (res && (res as any).ok) return (res as { data: T }).data;
  const e = (res as { error?: WireError })?.error;
  const err = new Error(e?.message ?? 'The request failed.') as Error & { code?: string; correlationId?: string; details?: unknown };
  err.code = e?.code;
  err.correlationId = e?.correlationId;
  err.details = e?.details;
  throw err;
}

const CHANNELS = new Set<string>(Object.values(IPC));
const api: Record<string, (payload?: any) => Promise<any>> = {};
for (const channel of CHANNELS) {
  if (channel.startsWith('event/')) continue;
  api[channel] = (payload?: any) => ipcRenderer.invoke(channel, payload).then(unwrap);
}

type Unsub = () => void;
const listeners: Record<string, Set<(payload?: any) => void>> = { lock: new Set(), session: new Set() };

ipcRenderer.on(IPC.onLock, () => listeners.lock.forEach((cb) => cb()));
ipcRenderer.on(IPC.onSessionExpired, (_e, reason: string) => listeners.session.forEach((cb) => cb(reason)));

function subscribe(kind: 'lock' | 'session', cb: (payload?: any) => void): Unsub {
  listeners[kind].add(cb);
  return () => listeners[kind].delete(cb);
}

contextBridge.exposeInMainWorld('dentiva', {
  ...api,
  onLock: (cb: () => void): Unsub => subscribe('lock', cb),
  onSessionExpired: (cb: (reason: string) => void): Unsub => subscribe('session', cb),
});
