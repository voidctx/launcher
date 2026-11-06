import path from 'node:path';

// Configuration defaults
export const SECURITY_CONFIG = {
  MAX_BODY_SIZE: 2 * 1024 * 1024,      // 2 MB default body limit
  MAX_UPLOAD_SIZE: 5 * 1024 * 1024,    // 5 MB module upload limit
  MAX_HEADER_SIZE: 16 * 1024,          // 16 KB total header limit
  REQUEST_TIMEOUT_MS: 15_000,          // 15 seconds request timeout
  EXECUTION_TIMEOUT_MS: 10_000         // 10 seconds module execution timeout
};

export class SecurityError extends Error {
  constructor(message, status = 400, headers = {}) {
    super(message);
    this.status = status;
    this.headers = headers;
  }
}

/**
 * 1. Host Sanitization and Validation
 * Prevents host header poisoning, SSRF vector attacks, and DNS rebinding.
 */
export function validateHostHeader(req) {
  const host = req.headers.host;
  if (!host || typeof host !== 'string') {
    throw new SecurityError('Host header is required', 400);
  }

  // Reject host containing control characters, null bytes, backslashes, or spaces
  if (/[\r\n\0\\ <>\'"`]/.test(host)) {
    throw new SecurityError('Malformed Host header detected', 400);
  }

  // Must match valid hostname/IP format with optional port
  // e.g. localhost, 127.0.0.1, [::1], mydomain.com:8080
  const validHostRegex = /^([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\-.]*[a-zA-Z0-9]|\[[0-9a-fA-F:]+\])(:[0-9]{1,5})?$/;
  if (!validHostRegex.test(host)) {
    throw new SecurityError('Invalid Host header format', 400);
  }

  return host;
}

/**
 * 2. Path Sanitization
 * Normalizes URL path and blocks directory traversal attempts.
 */
export function sanitizePath(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new SecurityError('Empty or invalid URL', 400);
  }

  // Check for null byte injection
  if (rawUrl.includes('\0') || rawUrl.includes('%00')) {
    throw new SecurityError('Null byte detected in path', 400);
  }

  // Check for directory traversal sequences before or after URL parsing
  if (
    rawUrl.includes('..') ||
    rawUrl.includes('%2e%2e') ||
    rawUrl.includes('%2E%2E') ||
    rawUrl.includes('%2e%2E') ||
    rawUrl.includes('%2E%2e')
  ) {
    throw new SecurityError('Directory traversal prohibited', 400);
  }

  let decodedPath = '';
  try {
    const urlObj = new URL(rawUrl, 'http://localhost');
    decodedPath = decodeURIComponent(urlObj.pathname);
  } catch (err) {
    throw new SecurityError('Malformed URL encoding', 400);
  }

  if (decodedPath.includes('..')) {
    throw new SecurityError('Directory traversal prohibited', 400);
  }

  // Normalize path using posix path rules
  const normalized = path.posix.normalize(decodedPath);
  return normalized;
}

/**
 * Validates module / service name format to ensure safe file resolution.
 * Only allows alphanumeric characters, underscores, and hyphens.
 */
export function validateServiceName(name) {
  if (!name || typeof name !== 'string') return false;
  return /^[a-zA-Z0-9_-]{1,64}$/.test(name);
}

/**
 * 3. Header Validation
 * Validates header length, content-length integrity, and header characters.
 */
export function validateHeaders(req) {
  let totalHeaderLength = 0;
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === 'string') {
      totalHeaderLength += key.length + value.length;
      // Prohibit CR/LF injection in headers
      if (/[\r\n]/.test(value)) {
        throw new SecurityError('Invalid characters in headers', 400);
      }
    }
  }

  if (totalHeaderLength > SECURITY_CONFIG.MAX_HEADER_SIZE) {
    throw new SecurityError('Request headers exceed maximum permitted size', 431);
  }

  // Validate Content-Length if provided
  const contentLength = req.headers['content-length'];
  if (contentLength !== undefined) {
    const parsed = Number(contentLength);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new SecurityError('Invalid Content-Length header', 400);
    }
  }

  return true;
}

/**
 * 4. Body Size Limits and Safe Body Reader
 * Enforces byte limit both upfront (via Content-Length) and while streaming chunks.
 */
export async function readRequestBody(req, maxBytes = SECURITY_CONFIG.MAX_BODY_SIZE) {
  // Pre-check Content-Length header
  const contentLength = req.headers['content-length'];
  if (contentLength && Number(contentLength) > maxBytes) {
    throw new SecurityError(`Payload exceeds maximum size limit of ${maxBytes} bytes`, 413);
  }

  return new Promise((resolve, reject) => {
    const chunks = [];
    let receivedBytes = 0;

    function onData(chunk) {
      receivedBytes += chunk.length;
      if (receivedBytes > maxBytes) {
        req.removeListener('data', onData);
        req.removeListener('end', onEnd);
        req.removeListener('error', onError);
        reject(new SecurityError(`Payload too large. Exceeded limit of ${maxBytes} bytes`, 413));
      } else {
        chunks.push(chunk);
      }
    }

    function onEnd() {
      const buffer = Buffer.concat(chunks);
      resolve(buffer.toString('utf-8'));
    }

    function onError(err) {
      reject(new SecurityError(`Error reading request stream: ${err.message}`, 400));
    }

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

/**
 * Helper to safely read and parse JSON body with size limits
 */
export async function readJsonBody(req, maxBytes = SECURITY_CONFIG.MAX_BODY_SIZE) {
  const raw = await readRequestBody(req, maxBytes);
  if (!raw || raw.trim().length === 0) return {};
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new SecurityError('Malformed JSON payload', 400);
  }
}

/**
 * 5. Timeouts
 * Wraps module execution in a timeout promise to prevent hung processes.
 */
export async function withExecutionTimeout(promise, timeoutMs = SECURITY_CONFIG.EXECUTION_TIMEOUT_MS) {
  let timerId;
  const timeoutPromise = new Promise((_, reject) => {
    timerId = setTimeout(() => {
      reject(new SecurityError(`Module execution timed out after ${timeoutMs}ms`, 504));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    return result;
  } finally {
    clearTimeout(timerId);
  }
}

/**
 * Apply standard security headers to outgoing responses.
 */
export function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
}
