import fs from 'node:fs';
import path from 'node:path';
import { scan } from './src/scanner.mjs';
import { ServiceError } from './src/errors.mjs';

const ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const MODULES_DIR = path.resolve(process.cwd(), 'modules');

export function isValidServiceName(name) {
  return typeof name === 'string' && ID_RE.test(name);
}

export function resolveServicePath(name) {
  if (!isValidServiceName(name)) {
    throw new ServiceError('BAD_REQUEST', { detail: `Invalid service identifier: "${name}"` });
  }
  const targetPath = path.resolve(MODULES_DIR, `${name}.mjs`);
  if (!targetPath.startsWith(MODULES_DIR + path.sep)) {
    throw new ServiceError('BAD_REQUEST', { detail: 'Path traversal detected' });
  }
  return targetPath;
}

export function serviceExists(name) {
  try {
    const p = resolveServicePath(name);
    return fs.existsSync(p) && fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

export function resolveAndScanService(name, options = {}) {
  const filePath = resolveServicePath(name);
  if (!fs.existsSync(filePath)) {
    throw new ServiceError('SERVICE_NOT_FOUND', { detail: `Service "${name}" not found in modules/` });
  }
  let code;
  try {
    code = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    throw new ServiceError('LOAD_FAILED', { detail: `Cannot read module file: ${err.message}` });
  }
  const report = scan(code, options);
  if (report.verdict === 'rejected' && !options.allowRejected) {
    const firstReason = report.reasons.find((r) => r.severity === 'high');
    const msg = firstReason ? `${firstReason.title}: ${firstReason.message}` : 'Security scan rejected';
    throw new ServiceError('INVALID_SOURCE', { detail: msg });
  }
  return { name, filePath, code, report };
}
