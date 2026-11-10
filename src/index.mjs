import { createRuntime } from './isolation.mjs';
import { scan, SCANNER_VERSION, RULES } from './scanner.mjs';
import { ServiceError } from './errors.mjs';
import { RUNTIME_DEFAULTS, SCAN_DEFAULTS } from './config.mjs';
export { scan, SCANNER_VERSION, RULES } from './scanner.mjs';
export { createRuntime } from './isolation.mjs';
export { ServiceError } from './errors.mjs';
export { RUNTIME_DEFAULTS, SCAN_DEFAULTS } from './config.mjs';

const runtime = createRuntime();

export const registerService = runtime.register;
export const unregisterService = runtime.unregister;
export const unloadService = runtime.unload;
export const runService = runtime.run;
export const serviceStats = runtime.stats;
export const shutdownRuntime = runtime.shutdown;
export const hasService = runtime.has;

export function deployService(id, code, { allowFlagged = false, limits, scanOptions } = {}) {
  const report = scan(code, scanOptions);
  const allowed = report.verdict === 'approved' || (allowFlagged && report.verdict === 'flagged');
  if (allowed) runtime.register(id, { code, limits });
  return { deployed: allowed, report };
}
