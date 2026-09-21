// Receipts, manuals, warranties and photos. File bytes live in the storage backend (DATA_DIR/files on
// disk by default, or an Azure Blob container), metadata lives in SQLite. Uploads are raw request
// bodies (no multipart parsing).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DOC_CATEGORIES } from './catalog.js';
import { DATA_DIR, db } from './db.js';
import { storageFromEnv } from './storage.js';
import { HttpError, clean } from './validate.js';

export const FILES_DIR = path.join(DATA_DIR, 'files');
export const storage = await storageFromEnv(process.env, { filesDir: FILES_DIR });

// Uploads are checked in a scratch folder first and only then handed to the storage backend.
const TMP_DIR = path.join(DATA_DIR, 'tmp');
fs.mkdirSync(TMP_DIR, { recursive: true });
for (const name of fs.readdirSync(TMP_DIR)) { // leftovers from an upload that was cut off
  const file = path.join(TMP_DIR, name);
  if (Date.now() - fs.statSync(file).mtimeMs > 3_600_000) fs.rmSync(file, { force: true });
}

export const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_MB || 25) * 1024 * 1024;

// Only these types are accepted. Types that browsers render safely are shown inline;
// everything else is always downloaded. The stored type comes from the extension, never the client.
const TYPES = {
  '.pdf': { mime: 'application/pdf', inline: true, magic: (b) => b.subarray(0, 4).toString('latin1') === '%PDF' },
  '.png': { mime: 'image/png', inline: true, magic: (b) => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) },
  '.jpg': { mime: 'image/jpeg', inline: true, magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  '.jpeg': { mime: 'image/jpeg', inline: true, magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  '.gif': { mime: 'image/gif', inline: true, magic: (b) => b.subarray(0, 4).toString('latin1') === 'GIF8' },
  '.webp': { mime: 'image/webp', inline: true, magic: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  '.heic': { mime: 'image/heic', inline: false },
  '.txt': { mime: 'text/plain', inline: false },
  '.csv': { mime: 'text/csv', inline: false },
  '.doc': { mime: 'application/msword', inline: false },
  '.docx': { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', inline: false },
  '.xls': { mime: 'application/vnd.ms-excel', inline: false },
  '.xlsx': { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', inline: false },
};

export const ALLOWED_EXTENSIONS = Object.keys(TYPES);

const DOC_FIELDS = {
  title: { type: 'text', max: 200, label: 'Title' },
  category: { type: 'enum', values: DOC_CATEGORIES.map((c) => c.key), default: 'other', label: 'Category' },
  appliance_id: { type: 'fk', label: 'Appliance' },
  item_id: { type: 'fk', label: 'Maintenance item' },
  completion_id: { type: 'fk', label: 'Service entry' },
  vendor_id: { type: 'fk', label: 'Vendor' },
  task_id: { type: 'fk', label: 'Project' },
  notes: { type: 'text', label: 'Notes' },
};

const SELECT = `SELECT d.id, d.title, d.category, d.filename, d.mime, d.size, d.notes, d.uploaded_at,
    d.appliance_id, d.item_id, d.completion_id, d.vendor_id, d.task_id,
    a.name AS appliance_name, m.name AS item_name, v.name AS vendor_name, t.title AS task_title
  FROM documents d
  LEFT JOIN appliances a ON a.id = d.appliance_id
  LEFT JOIN maintenance_items m ON m.id = d.item_id
  LEFT JOIN vendors v ON v.id = d.vendor_id
  LEFT JOIN tasks t ON t.id = d.task_id`;

const cleanFilename = (raw) => {
  const base = path.basename(String(raw || '').replace(/\\/g, '/'));
  return base.replace(/[\x00-\x1f\x7f<>:"|?*]/g, '').trim().slice(0, 200);
};

export function listDocuments({ q, category, applianceId, itemId, completionId, vendorId, taskId } = {}) {
  const where = [];
  const params = [];
  if (q) {
    const like = `%${q.replace(/[!%_]/g, '!$&')}%`; // '!' is the LIKE escape character
    where.push("(d.title LIKE ? ESCAPE '!' OR d.filename LIKE ? ESCAPE '!' OR d.notes LIKE ? ESCAPE '!')");
    params.push(like, like, like);
  }
  for (const [col, val] of [['category', category], ['appliance_id', applianceId], ['item_id', itemId],
    ['completion_id', completionId], ['vendor_id', vendorId], ['task_id', taskId]]) {
    if (val) { where.push(`d.${col} = ?`); params.push(val); }
  }
  return db.prepare(`${SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY d.uploaded_at DESC, d.id DESC`).all(...params);
}

export function getDocument(id) {
  const row = db.prepare(`${SELECT} WHERE d.id = ?`).get(id);
  if (!row) throw new HttpError(404, 'Not found');
  return row;
}

/** Streams an upload to a scratch file, checks it, then stores it. File name comes from the X-Filename header, details from the query string. */
export async function saveUpload(req, query) {
  const filename = cleanFilename(decodeURIComponent(req.headers['x-filename'] || ''));
  const ext = path.extname(filename).toLowerCase();
  const type = TYPES[ext];
  if (!filename || !type) throw new HttpError(415, `Unsupported file type. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`);

  const declared = Number(req.headers['content-length']);
  if (declared > MAX_UPLOAD_BYTES) throw new HttpError(413, `File is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`);

  const meta = clean(DOC_FIELDS, Object.fromEntries(query.entries()));
  if (!meta.title) meta.title = path.basename(filename, ext);

  const storedName = `${crypto.randomUUID()}${ext}`;
  const tmp = path.join(TMP_DIR, `upload-${storedName}`);
  let size = 0;
  const limiter = new Transform({
    transform(chunk, _enc, cb) {
      size += chunk.length;
      cb(size > MAX_UPLOAD_BYTES ? new HttpError(413, `File is larger than ${MAX_UPLOAD_BYTES / 1024 / 1024} MB`) : null, chunk);
    },
  });

  try {
    await pipeline(req, limiter, fs.createWriteStream(tmp, { flags: 'wx' }));
    if (!size) throw new HttpError(400, 'The file is empty');
    if (type.magic) {
      const head = Buffer.alloc(12);
      const fd = fs.openSync(tmp, 'r');
      try { fs.readSync(fd, head, 0, 12, 0); } finally { fs.closeSync(fd); }
      if (!type.magic(head)) throw new HttpError(415, 'The file contents do not match its type');
    }
    await storage.putFile(storedName, tmp, { contentType: type.mime });
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }

  const cols = ['filename', 'stored_name', 'mime', 'size', ...Object.keys(meta)];
  try {
    const res = db
      .prepare(`INSERT INTO documents (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
      .run(filename, storedName, type.mime, size, ...Object.values(meta));
    return getDocument(Number(res.lastInsertRowid));
  } catch (err) {
    await storage.remove(storedName).catch((e) => console.error(`[documents] could not clean up ${storedName}: ${e.message}`));
    throw err;
  }
}

export function updateDocument(id, body) {
  getDocument(id);
  const values = clean(DOC_FIELDS, body, { partial: true });
  if ('title' in values && !values.title) throw new HttpError(400, 'Title is required');
  const cols = Object.keys(values);
  if (cols.length) {
    db.prepare(`UPDATE documents SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...Object.values(values), id);
  }
  return getDocument(id);
}

export async function deleteDocument(id) {
  getDocument(id);
  const { stored_name: stored } = db.prepare('SELECT stored_name FROM documents WHERE id = ?').get(id);
  db.prepare('DELETE FROM documents WHERE id = ?').run(id);
  // The record is already gone, so a storage hiccup must not turn into an error the user can't act on.
  await storage.remove(stored).catch((e) => console.error(`[documents] could not delete ${stored}: ${e.message}`));
}

/** Sends the file with headers that keep it from ever being treated as a web page. */
export async function sendDocument(res, id, { download = false } = {}) {
  getDocument(id);
  const row = db.prepare('SELECT filename, stored_name, mime, size FROM documents WHERE id = ?').get(id);
  const file = await storage.openRead(row.stored_name);
  if (!file) throw new HttpError(404, 'The file is missing from storage');

  const ext = path.extname(row.filename).toLowerCase();
  const inline = !download && TYPES[ext]?.inline;
  const headers = {
    'Content-Type': row.mime,
    'Content-Length': row.size,
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, max-age=300',
  };
  // Chrome's built-in PDF viewer won't run under a sandboxed CSP, so PDFs keep the app-wide policy instead.
  if (ext !== '.pdf') headers['Content-Security-Policy'] = "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src 'self'";
  res.writeHead(200, headers);
  try {
    await pipeline(file.stream, res);
  } catch (err) {
    console.error(`[documents] download of ${row.stored_name} failed: ${err.message}`);
    res.destroy(); // headers are already out, so the only honest signal left is a cut connection
  }
}
