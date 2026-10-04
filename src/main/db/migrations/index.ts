import type { DB } from '../database';
import { migration001 } from './001_init';

export interface Migration {
  version: number;
  name: string;
  up: (db: DB) => void;
}

export const MIGRATIONS: Migration[] = [
  {
    version: migration001.version,
    name: migration001.name,
    up(db: DB) {
      db.exec(migration001.ddl);
      migration001.seed(db);
    },
  },
];
