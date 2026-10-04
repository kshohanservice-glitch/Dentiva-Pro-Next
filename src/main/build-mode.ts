import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

export function isDemoBuild(): boolean {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8')) as { dentivaBuildMode?: string };
    return pkg.dentivaBuildMode === 'demo' || app.getName() === 'Dentiva Pro Demo';
  } catch {
    return false;
  }
}
