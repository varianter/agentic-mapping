import { Database } from 'bun:sqlite';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function backupDatabase(source: string, destination: string) {
  const target = resolve(destination);
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  const db = new Database(source, { readonly: true });
  try {
    db.query('VACUUM INTO ?').run(target);
    chmodSync(target, 0o600);
  } finally {
    db.close();
  }
}

if (import.meta.main) {
  const destination = process.argv[2];
  if (!destination) throw new Error('Usage: bun run backup /private/path/new-backup.sqlite');
  backupDatabase(process.env.DATABASE_PATH ?? './data/sheets.sqlite', destination);
  console.log('Backup complete. Encrypt and copy it off-host.');
}
