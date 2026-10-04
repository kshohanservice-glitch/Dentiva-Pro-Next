import { randomBytes } from 'node:crypto';
import type { Algorithm } from '@node-rs/argon2';

type Argon2Api = { hash: (password: string, options: object) => Promise<string>; verify: (phc: string, password: string) => Promise<boolean> };

function loadArgon2(): Argon2Api {
  if (process.platform === 'win32' && process.arch === 'x64') {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const nativePath = require.resolve('@node-rs/argon2-win32-x64-msvc');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require(nativePath) as Argon2Api;
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@node-rs/argon2') as Argon2Api;
}

const argon2 = loadArgon2();

// Argon2id === 2 (Algorithm enum value inlined: ambient const enums cannot
// be read as values when isolatedModules is enabled).
const ARGON_OPTS = {
  algorithm: 2 as unknown as Algorithm,
  memoryCost: 19456, // KiB
  timeCost: 2,
  parallelism: 1,
};

/** Argon2id password hash (PHC string). Never log or audit the input or output. */
export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON_OPTS);
}

export async function verifyPassword(phc: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(phc, password);
  } catch {
    return false;
  }
}

let dummyHash: string | null = null;
/** Verify against a throwaway hash when the user does not exist (timing equalization). */
export async function dummyVerify(password: string): Promise<false> {
  if (!dummyHash) dummyHash = await hashPassword(cryptoRandom());
  await verifyPassword(dummyHash, password);
  return false;
}

function cryptoRandom(): string {
  return randomBytes(24).toString('hex');
}
