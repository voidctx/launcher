import { ServiceError } from './errors.mjs';
import { BLOCKED_RESPONSE_HEADERS } from './config.mjs';

const METHOD_RE = /^[A-Z]{1,16}$/;
const HEADER_NAME_RE = /^[a-z0-9!#$%&'*+.^_`|~-]{1,64}$/;
const HEADER_VALUE_RE = /^[\t\x20-\x7e]*$/;

export function normalizeRequest(input, options) {
  if (!input || typeof input !== 'object') {
    throw new ServiceError('BAD_REQUEST', { detail: 'request must be an object' });
  }

  const method = String(input.method || 'GET').toUpperCase();
  if (!METHOD_RE.test(method)) {
    throw new ServiceError('BAD_REQUEST', { detail: 'invalid method' });
  }

  const url = String(input.url === undefined ? '/' : input.url);
  if (url.length > 8192) {
    throw new ServiceError('BAD_REQUEST', { detail: 'url too long' });
  }
  let parsed;
  try {
    parsed = new URL(url, 'http://sandbox.invalid');
  } catch {
    throw new ServiceError('BAD_REQUEST', { detail: 'invalid url' });
  }
  const query = Object.create(null);
  for (const [k, v] of parsed.searchParams) {
    if (k in query) {
      query[k] = Array.isArray(query[k]) ? [...query[k], v] : [query[k], v];
    } else {
      query[k] = v;
    }
  }

  if (input.headers !== undefined && input.headers !== null &&
      (typeof input.headers !== 'object' || Array.isArray(input.headers))) {
    throw new ServiceError('BAD_REQUEST', { detail: 'headers must be an object' });
  }
  const strip = new Set(options.stripRequestHeaders.map((h) => h.toLowerCase()));
  const headers = Object.create(null);
  let count = 0;
  for (const [rawName, rawValue] of Object.entries(input.headers || {})) {
    const name = String(rawName).toLowerCase();
    if (strip.has(name)) continue;
    if (++count > 100) throw new ServiceError('BAD_REQUEST', { detail: 'too many headers' });
    const value = Array.isArray(rawValue) ? rawValue.join(', ') : String(rawValue);
    if (value.length > 8192) throw new ServiceError('BAD_REQUEST', { detail: 'header too long' });
    headers[name] = value;
  }

  let body = null;
  if (input.body !== undefined && input.body !== null) {
    if (typeof input.body === 'string') body = input.body;
    else if (input.body instanceof Uint8Array) body = Buffer.from(input.body).toString('utf8');
    else throw new ServiceError('BAD_REQUEST', { detail: 'body must be a string or Buffer' });
    if (Buffer.byteLength(body, 'utf8') > options.maxRequestBytes) {
      throw new ServiceError('REQUEST_TOO_LARGE');
    }
  }

  return JSON.stringify({ method, url, path: parsed.pathname, query, headers, body });
}

function bad(detail) {
  return new ServiceError('BAD_RESPONSE', { detail });
}

export function sanitizeResponse(raw, options) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw bad('the handler must return an object like { status, headers, body }');
  }

  const status = raw.status === undefined ? 200 : raw.status;
  if (!Number.isInteger(status) || status < 200 || status > 599) {
    throw bad('status must be an integer between 200 and 599');
  }

  const warnings = [];
  const headers = {};
  if (raw.headers !== undefined) {
    if (!raw.headers || typeof raw.headers !== 'object' || Array.isArray(raw.headers)) {
      throw bad('headers must be an object');
    }
    let count = 0;
    for (const [k, v] of Object.entries(raw.headers)) {
      if (++count > 50) throw bad('too many response headers');
      const name = String(k).toLowerCase();
      if (!HEADER_NAME_RE.test(name)) throw bad('invalid response header name');
      if (BLOCKED_RESPONSE_HEADERS.has(name)) {
        warnings.push(`response header "${name}" was removed`);
        continue;
      }
      if (typeof v !== 'string' && typeof v !== 'number') throw bad(`header "${name}" must be a string`);
      const value = String(v);
      if (value.length > 4096 || !HEADER_VALUE_RE.test(value)) throw bad(`header "${name}" has an invalid value`);
      headers[name] = value;
    }
  }

  let body = raw.body === undefined ? '' : raw.body;
  if (typeof body !== 'string') throw bad('body must be a string');
  if (Buffer.byteLength(body, 'utf8') > options.maxResponseBytes) {
    throw new ServiceError('RESPONSE_TOO_LARGE');
  }

  if (!('content-type' in headers)) headers['content-type'] = 'text/plain; charset=utf-8';
  for (const [k, v] of Object.entries(options.forceResponseHeaders || {})) {
    headers[k.toLowerCase()] = v;
  }

  return { status, headers, body, warnings };
}
