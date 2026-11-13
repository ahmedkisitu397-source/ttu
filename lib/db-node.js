// node:sqlite driver for running TTu as a plain Node server (see server.js).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export function nodeSqliteDriver(file = process.env.DATABASE_PATH || path.resolve('data/ttu.db')) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sqlite = new DatabaseSync(file);
  sqlite.exec('PRAGMA journal_mode=WAL;');
  sqlite.exec(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  return {
    prepare(sql) {
      const st = sqlite.prepare(sql);
      return { get: async (...a) => st.get(...a), all: async (...a) => st.all(...a), run: async (...a) => st.run(...a) };
    },
  };
}
