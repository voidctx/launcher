import { createRuntime } from './isolation.mjs';
import { scan } from './scanner.mjs';

/**
 * Public API of the Tamo module.
 *
 *   scan(code, options?)                      -> report   (see scanner.mjs)
 *   deployService(id, code, options?)         scan + register in one call
 *   runService(id, req)                       -> { status, headers, body, logs, warnings, meta }
 *   unloadService(id, { force? })             free the worker, keep the registration
 *   unregisterService(id)                     remove the service
 *   serviceStats()                            state of every service
 *   shutdownRuntime()                         stop all workers
 *
 * runService throws ServiceError (err.code, err.status, err.publicMessage).
 * createRuntime(options) gives an independent runtime (used by the tests and
 * for custom limits).
 */

export { scan, SCANNER_VERSION, RULES } from './scanner.mjs';
export { createRuntime } from './isolation.mjs';
export { ServiceError, ERROR_CODES } from './errors.mjs';
export { RUNTIME_DEFAULTS, SCAN_DEFAULTS } from './config.mjs';

const runtime = createRuntime();

export const registerService = runtime.register;
export const unregisterService = runtime.unregister;
export const unloadService = runtime.unload;
export const runService = runtime.run;
export const serviceStats = runtime.stats;
export const shutdownRuntime = runtime.shutdown;
export const hasService = runtime.has;

/**
 * Scans the code and registers it when the verdict allows it.
 *   approved -> registered
 *   flagged  -> registered only with { allowFlagged: true } (admin approval)
 *   rejected -> never registered
 * Returns { deployed, report }.
 */
export function deployService(id, code, { allowFlagged = false, limits, scanOptions } = {}) {
  const report = scan(code, scanOptions);
  const allowed = report.verdict === 'approved' || (allowFlagged && report.verdict === 'flagged');
  if (allowed) runtime.register(id, { code, limits });
  return { deployed: allowed, report };
}
