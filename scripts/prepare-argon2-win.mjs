import fs from 'node:fs';
import path from 'node:path';

// Deterministic staging keeps the Windows binding beside index.js so Node's first native lookup succeeds.
if (process.platform !== 'win32') {
  console.log('Argon2 staging skipped: not Windows.');
  process.exit(0);
}

const root = process.cwd();
const source = path.join(
  root,
  'node_modules',
  '@node-rs',
  'argon2-win32-x64-msvc',
  'argon2.win32-x64-msvc.node',
);
const targetDir = path.join(root, 'node_modules', '@node-rs', 'argon2');
const target = path.join(targetDir, 'argon2.win32-x64-msvc.node');

if (!fs.existsSync(source)) {
  throw new Error(
    `Windows Argon2 native binary is missing: ${source}. ` +
    'Install dependencies on Windows with npm ci so the platform optional dependency is present.',
  );
}

fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(source, target);

if (!fs.existsSync(target) || fs.statSync(target).size === 0) {
  throw new Error(`Failed to stage Windows Argon2 native binary: ${target}`);
}

console.log(`Staged Windows Argon2 native binding: ${target} (${fs.statSync(target).size} bytes)`);
