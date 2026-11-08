/**
 * Every failure of the runtime is a ServiceError.
 *
 *   err.code            stable machine-readable code (see CODES)
 *   err.status          HTTP status the gateway should answer with
 *   err.publicMessage   generic text that is safe to show to any caller
 *   err.message         same as publicMessage
 *   err.detail          internal detail (may contain text written by the
 *                       service author - escape it before putting it in HTML)
 *   err.retryAfterSec   set for QUARANTINED / QUEUE_FULL
 */
const CODES = {
  BAD_REQUEST:         [400, 'Invalid request'],
  REQUEST_TOO_LARGE:   [413, 'Request body too large'],
  SERVICE_NOT_FOUND:   [404, 'Service not found'],
  INVALID_SOURCE:      [400, 'Service code is not valid'],
  LOAD_FAILED:         [500, 'Service failed to start'],
  HANDLER_ERROR:       [500, 'Service raised an error'],
  BAD_RESPONSE:        [502, 'Service returned an invalid response'],
  RESPONSE_TOO_LARGE:  [502, 'Service response too large'],
  TIMEOUT:             [504, 'Service timed out'],
  OUT_OF_MEMORY:       [500, 'Service ran out of memory'],
  CRASHED:             [500, 'Service crashed'],
  QUEUE_FULL:          [503, 'Service is busy'],
  QUARANTINED:         [503, 'Service is temporarily disabled after repeated failures'],
  SHUTTING_DOWN:       [503, 'Runtime is shutting down']
};

export class ServiceError extends Error {
  constructor(code, { detail, retryAfterSec } = {}) {
    const entry = CODES[code] || [500, 'Internal error'];
    super(entry[1]);
    this.name = 'ServiceError';
    this.code = code;
    this.status = entry[0];
    this.publicMessage = entry[1];
    if (detail !== undefined) this.detail = String(detail).slice(0, 500);
    if (retryAfterSec !== undefined) this.retryAfterSec = retryAfterSec;
  }
}

export const ERROR_CODES = Object.freeze(Object.keys(CODES));
