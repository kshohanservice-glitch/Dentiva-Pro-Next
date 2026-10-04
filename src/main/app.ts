import type { DB } from './db/database';

/**
 * Central database handle holder — lets services that are invoked outside the
 * normal request path (activation audit, restore rollback) reach the live DB
 * while keeping the swap point in exactly one place.
 */
let current: DB | null = null;

export function setDb(db: DB): void {
  current = db;
}

export function getDb(): DB {
  if (!current) throw new Error('Database is not initialized yet.');
  return current;
}
