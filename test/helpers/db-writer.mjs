// Stand-in for the app in the Litestream integration test: creates the database (after Litestream has
// started, like a fresh install) and inserts rows.
// usage: node db-writer.mjs <dbFile> <rows> <delayMs> <progressFile>
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const [dbFile, rows, delay, progressFile] = process.argv.slice(2);
// `node --test` runs every file under test/ once with no arguments; do nothing in that case.
if (!dbFile) process.exit(0);
const db = new DatabaseSync(dbFile);
db.exec('PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS t (id INTEGER PRIMARY KEY, at INTEGER);');
let i = 0;
const tick = () => {
  i += 1;
  db.prepare('INSERT INTO t (at) VALUES (?)').run(Date.now());
  fs.writeFileSync(progressFile, String(i)); // written after the commit: the last row known to be in SQLite
  if (i >= Number(rows)) { db.close(); process.exit(0); }
  setTimeout(tick, Number(delay));
};
tick();
