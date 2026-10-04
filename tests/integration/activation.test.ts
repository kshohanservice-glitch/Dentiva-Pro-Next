import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { activationCode } from '../helpers';
import { ActivationStore, verifyActivationCode, weakCipher } from '../../src/main/core/activation';

/** The activation code itself must never appear in any source or test file. */
const FORBIDDEN = activationCode();

describe('activation (offline, derived verifier only)', () => {
  it('accepts the licensed activation code', () => {
    expect(verifyActivationCode(activationCode())).toBe(true);
  });

  it('tolerates spaces and dashes as users type them', () => {
    const spaced = activationCode().replace(/(\d{4})(?=\d)/g, '$1 ');
    expect(verifyActivationCode(spaced)).toBe(true);
    expect(verifyActivationCode(activationCode().replace(/(\d{4})(?=\d)/g, '$1-'))).toBe(true);
  });

  it('rejects wrong, empty and malformed codes', () => {
    expect(verifyActivationCode('')).toBe(false);
    expect(verifyActivationCode('0000000000000000')).toBe(false);
    expect(verifyActivationCode('12345678')).toBe(false);
    expect(verifyActivationCode(`${activationCode().slice(0, -1)}9`)).toBe(false);
    expect(verifyActivationCode(FORBIDDEN.slice(0, 15))).toBe(false);
    expect(verifyActivationCode('not-a-code')).toBe(false);
    expect(verifyActivationCode('9'.repeat(65))).toBe(false);
    expect(verifyActivationCode(undefined as unknown as string)).toBe(false);
  });

  it('stores activation state without any plaintext code material', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dentiva-activation-'));
    try {
      const file = path.join(dir, 'state.bin');
      const store = new ActivationStore(file, weakCipher);

      expect(store.getStatus()).toEqual({ activated: false, state: 'unactivated' });
      expect(store.activate('0000000000000000').state).toBe('invalid');
      expect(fs.existsSync(file)).toBe(false);

      const ok = store.activate(activationCode());
      expect(ok.activated).toBe(true);
      expect(ok.state).toBe('activated');
      expect(store.getStatus().activated).toBe(true);

      const raw = fs.readFileSync(file);
      const text = raw.toString('utf8');
      expect(text).not.toContain(FORBIDDEN);
      expect(text).not.toContain(activationCode());
      expect(raw.includes(Buffer.from(activationCode()))).toBe(false);

      store.requireActivated(); // must not throw
      store.clear();
      expect(store.getStatus().activated).toBe(false);

      // tampered container → invalid, not crash
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from([1, 2, 3, 4]));
      expect(store.getStatus().state).toBe('invalid');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('code literal is absent from repository sources', () => {
    const roots = ['src', 'tests', 'docs', 'e2e', 'scripts', '.github', 'assets'];
    const hits: string[] = [];
    const walk = (dir: string): void => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else {
          try {
            const content = fs.readFileSync(p, 'utf8');
            if (content.includes(FORBIDDEN)) hits.push(p);
          } catch { /* binary */ }
        }
      }
    };
    const repoRoot = path.resolve(__dirname, '../..');
    for (const r of roots) walk(path.join(repoRoot, r));
    expect(hits).toEqual([]);
  });
});
