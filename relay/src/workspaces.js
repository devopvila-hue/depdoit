import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { openDb } from './db.js';
import { createStore } from './store.js';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

/** Separate durable SQLite per verified Supabase organization. No shared fallback. */
export function createWorkspaceManager(directory) {
  mkdirSync(directory, { recursive: true });
  const workspaces = new Map();
  return {
    get(organizationId) {
      if (!UUID.test(organizationId || '')) throw new Error('Invalid verified organization');
      if (!workspaces.has(organizationId)) {
        const db = openDb(path.join(directory, `${organizationId.toLowerCase()}.db`));
        workspaces.set(organizationId, { db, store: createStore(db) });
      }
      return workspaces.get(organizationId);
    },
    close() { for (const { db } of workspaces.values()) db.close(); workspaces.clear(); },
  };
}
