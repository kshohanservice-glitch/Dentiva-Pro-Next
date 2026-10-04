import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { AppError } from '../errors';

/**
 * Offline activation verifier.
 *
 * The plaintext activation code is NOT present anywhere in this codebase,
 * configuration, tests, assets or logs. Only a PBKDF2-HMAC-SHA256 derived
 * verifier is embedded, and it is stored XOR-sharded (not as an obvious literal).
 *
 * Honest limitation: fully offline software with a fixed activation secret
 * cannot make that secret mathematically unrecoverable to a determined
 * reverse-engineer; this design minimizes attack surface without claiming
 * perfect secrecy (documented in docs/SECURITY.md and the About screen).
 */
const SALT_HEX = 'a7f3c91e5b2d84f0c6e1a9d47b3f5820';
const ITERATIONS = 480000;
const SHARD = [98, 19, 66, 31, 80, 174, 222, 139, 88, 132, 252, 219, 230, 72, 8, 128, 97, 63, 88, 99, 37, 192, 73, 184, 48, 104, 173, 20, 176, 213, 125, 148];
const XKEY = Buffer.from('DentivaPro-KDF-v1!', 'utf8');

function unshard(): Buffer {
  const out = Buffer.alloc(SHARD.length);
  for (let i = 0; i < SHARD.length; i++) out[i] = SHARD[i] ^ XKEY[i % XKEY.length];
  return out;
}

/** Constant-time verification of an entered activation code against the embedded verifier. */
export function verifyActivationCode(entered: string): boolean {
  if (typeof entered !== 'string' || entered.length === 0 || entered.length > 64) return false;
  const normalized = entered.replace(/[\s-]/g, '');
  if (!/^\d{8,32}$/.test(normalized)) return false;
  const derived = crypto.pbkdf2Sync(normalized, Buffer.from(SALT_HEX, 'hex'), ITERATIONS, 32, 'sha256');
  const expected = unshard();
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export interface Cipher {
  encrypt(buf: Buffer): Buffer;
  decrypt(buf: Buffer): Buffer;
}

/** Fallback cipher for environments without OS key storage (dev/Linux without keyring). */
export const weakCipher: Cipher = {
  encrypt: (b) => Buffer.concat([Buffer.from('W1:', 'utf8'), b]),
  decrypt: (b) => {
    const s = b.toString('utf8');
    if (!s.startsWith('W1:')) throw new Error('Invalid activation state container');
    return Buffer.from(s.slice(3), 'utf8');
  },
};

export interface ActivationState {
  activatedAt: string;
  formatVersion: 1;
}

export class ActivationStore {
  constructor(private readonly file: string, private readonly cipher: Cipher) {}

  getStatus(): { activated: boolean; state: 'unactivated' | 'activated' | 'invalid' } {
    try {
      if (!fs.existsSync(this.file)) return { activated: false, state: 'unactivated' };
      const raw = fs.readFileSync(this.file);
      const json = JSON.parse(this.cipher.decrypt(raw).toString('utf8')) as ActivationState;
      if (json && json.formatVersion === 1 && typeof json.activatedAt === 'string') {
        return { activated: true, state: 'activated' };
      }
      return { activated: false, state: 'invalid' };
    } catch {
      return { activated: false, state: 'invalid' };
    }
  }

  activate(enteredCode: string): { activated: boolean; state: 'unactivated' | 'activated' | 'invalid' } {
    if (!verifyActivationCode(enteredCode)) {
      return { activated: false, state: 'invalid' };
    }
    const state: ActivationState = { activatedAt: new Date().toISOString(), formatVersion: 1 };
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, this.cipher.encrypt(Buffer.from(JSON.stringify(state), 'utf8')));
    fs.renameSync(tmp, this.file);
    return { activated: true, state: 'activated' };
  }

  requireActivated(): void {
    const status = this.getStatus();
    if (!status.activated) {
      throw new AppError('ACTIVATION', 'Dentiva Pro requires one-time offline activation before use.');
    }
  }

  clear(): void {
    if (fs.existsSync(this.file)) fs.rmSync(this.file, { force: true });
  }
}
