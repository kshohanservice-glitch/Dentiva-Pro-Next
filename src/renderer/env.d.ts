/// <reference types="vite/client" />
import type { DentivaApi } from '../shared/ipc';

export type DentivaBridge = DentivaApi & {
  onLock(cb: () => void): () => void;
  onSessionExpired(cb: (reason: string) => void): () => void;
};

declare global {
  interface Window {
    dentiva: DentivaBridge;
  }
}

export {};
