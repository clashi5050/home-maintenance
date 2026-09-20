import { isValidDate } from './dates.js';

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Validates a request body against a field spec and returns only the known columns.
 * Empty strings become null. With `partial`, fields missing from the body are skipped.
 */
export function clean(fields, body, { partial = false } = {}) {
  if (!body || typeof body !== 'object') throw new HttpError(400, 'Expected a JSON object');
  const out = {};

  for (const [name, f] of Object.entries(fields)) {
    if (partial && !(name in body)) continue;
    const label = f.label || name;
    let v = body[name];
    if (typeof v === 'string') v = v.trim();

    if (v === '' || v === undefined || v === null) {
      if (f.required) throw new HttpError(400, `${label} is required`);
      out[name] = f.default ?? null;
      continue;
    }

    switch (f.type) {
      case 'text':
        v = String(v);
        if (v.length > (f.max ?? 2000)) throw new HttpError(400, `${label} is too long`);
        break;
      case 'int':
      case 'fk':
        v = Number(v);
        if (!Number.isInteger(v) || v < (f.min ?? 0) || v > (f.max ?? 1e9)) throw new HttpError(400, `${label} is not valid`);
        break;
      case 'real':
        v = Number(v);
        if (!Number.isFinite(v) || v < 0 || v > 1e9) throw new HttpError(400, `${label} must be a positive amount`);
        break;
      case 'date':
        if (!isValidDate(v)) throw new HttpError(400, `${label} must be a date (YYYY-MM-DD)`);
        break;
      case 'enum':
        if (!f.values.includes(v)) throw new HttpError(400, `${label} must be one of: ${f.values.join(', ')}`);
        break;
      default:
        throw new Error(`Unknown field type ${f.type}`);
    }
    out[name] = v;
  }
  return out;
}
