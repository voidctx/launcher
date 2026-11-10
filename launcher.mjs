import http from 'node:http';
import {
  runService,
  deployService,
  unloadService,
  unregisterService,
  serviceStats,
  shutdownRuntime,
  hasService,
  registerService,
  ServiceError
} from './src/index.mjs';
import {
  resolveAndScanService,
  isValidServiceName,
  serviceExists
} from './resolve.mjs';
import { genError, homePage } from './pages.mjs';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const MAX_REQUEST_BYTES = 1024 * 1024; // 1 MB max request body

function readBody(req) {
  return new Promise((resolve, reject) => {
    let bytes = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_REQUEST_BYTES) {
        req.destroy(new ServiceError('REQUEST_TOO_LARGE'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      resolve(chunks.length > 0 ? Buffer.concat(chunks).toString('utf8') : null);
    });
    req.on('error', (err) => reject(err));
  });
}

function sendResponse(res, status, headers, body) {
  if (res.headersSent) return;
  res.writeHead(status, headers);
  res.end(body || '');
}

function sendJson(res, status, data, extraHeaders = {}) {
  sendResponse(
    res,
    status,
    {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders
    },
    JSON.stringify(data)
  );
}

function sendError(req, res, err) {
  if (res.headersSent) return;
  const status = err instanceof ServiceError ? err.status : 500;
  const publicMessage = err instanceof ServiceError ? err.publicMessage : 'Internal Server Error';
  const detail = err instanceof ServiceError ? err.detail : undefined;
  const extraHeaders = {};

  if (err && err.retryAfterSec) {
    extraHeaders['Retry-After'] = String(err.retryAfterSec);
  }

  const acceptsJson = (req.headers.accept && req.headers.accept.includes('application/json')) ||
                      req.url.startsWith('/api/');

  if (acceptsJson) {
    sendJson(res, status, {
      error: err.code || 'INTERNAL_ERROR',
      message: publicMessage,
      detail: detail || undefined,
      status
    }, extraHeaders);
  } else {
    sendResponse(
      res,
      status,
      {
        'Content-Type': 'text/html; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
        ...extraHeaders
      },
      genError(status, err)
    );
  }
}

export const server = http.createServer(async (req, res) => {
  const host = req.headers.host || 'localhost';
  let urlObj;
  try {
    urlObj = new URL(req.url, `http://${host}`);
  } catch {
    return sendError(req, res, new ServiceError('BAD_REQUEST', { detail: 'Malformed URL' }));
  }

  const pathname = urlObj.pathname;

  if (pathname === '/favicon.ico') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (pathname === '/' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(homePage);
    return;
  }

  if (pathname === '/api/stats' && req.method === 'GET') {
    return sendJson(res, 200, {
      runtime: 'Launcher-Workerd-V2',
      zeroDependency: true,
      stats: serviceStats()
    });
  }

  if (pathname === '/api/deploy' && req.method === 'POST') {
    try {
      const bodyText = await readBody(req);
      let payload;
      try {
        payload = JSON.parse(bodyText || '{}');
      } catch {
        throw new ServiceError('BAD_REQUEST', { detail: 'Deploy body must be valid JSON' });
      }

      const { name, code, allowFlagged } = payload;
      if (!isValidServiceName(name)) {
        throw new ServiceError('BAD_REQUEST', { detail: 'Valid service name required [a-zA-Z0-9_-]{1,64}' });
      }
      if (typeof code !== 'string' || code.length === 0) {
        throw new ServiceError('BAD_REQUEST', { detail: 'Code must be a non-empty string' });
      }

      const result = deployService(name, code, { allowFlagged: !!allowFlagged });
      return sendJson(res, result.deployed ? 200 : 400, result);
    } catch (err) {
      return sendError(req, res, err);
    }
  }

  if (pathname.startsWith('/api/services/') && pathname.endsWith('/unload') && req.method === 'POST') {
    const parts = pathname.slice('/api/services/'.length).split('/');
    const name = parts[0];
    try {
      const unloaded = unloadService(name, { force: true });
      return sendJson(res, 200, { service: name, unloaded });
    } catch (err) {
      return sendError(req, res, err);
    }
  }

  if (pathname.startsWith('/api/services/') && req.method === 'DELETE') {
    const name = pathname.slice('/api/services/'.length);
    try {
      const removed = unregisterService(name);
      return sendJson(res, removed ? 200 : 404, { service: name, removed });
    } catch (err) {
      return sendError(req, res, err);
    }
  }

  let rawServiceName = pathname.slice(1);
  if (rawServiceName.startsWith('svc/')) {
    rawServiceName = rawServiceName.slice(4);
  }
  const serviceName = rawServiceName.split('/')[0];
  if (!isValidServiceName(serviceName)) {
    return sendError(req, res, new ServiceError('BAD_REQUEST', { detail: `Invalid service route: /${rawServiceName}` }));
  }

  try {
    if (!hasService(serviceName)) {
      if (serviceExists(serviceName)) {
        const { code } = resolveAndScanService(serviceName);
        registerService(serviceName, { code });
      } else {
        throw new ServiceError('SERVICE_NOT_FOUND', { detail: `Service "${serviceName}" is not registered or found on disk` });
      }
    }

    const body = await readBody(req);
    const result = await runService(serviceName, {
      method: req.method,
      url: req.url,
      headers: req.headers,
      body
    });
    const telemetryHeaders = {
      ...result.headers,
      'X-Execution-Status': 'success',
      'X-Handler-Time-Ms': result.meta ? result.meta.handlerMs.toFixed(3) : '0',
      'X-Total-Time-Ms': result.meta ? result.meta.totalMs.toFixed(3) : '0',
      'X-Cold-Start': String(result.meta ? result.meta.coldStart : false),
      'X-Memory-Heap-Bytes': String(result.meta ? result.meta.heapUsedBytes : 0),
      'X-Queued-Time-Ms': result.meta ? result.meta.queuedMs.toFixed(3) : '0'
    };

    sendResponse(res, result.status, telemetryHeaders, result.body);
  } catch (err) {
    sendError(req, res, err);
  }
});

async function gracefulShutdown(signal) {
  console.log(`\nReceived ${signal}. Gracefully shutting down Launcher runtime...`);
  server.close(async () => {
    try {
      await shutdownRuntime();
      console.log('All sandboxed service workers cleanly terminated.');
      process.exit(0);
    } catch (err) {
      console.error('Error during shutdown:', err);
      process.exit(1);
    }
  });
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

import { fileURLToPath } from 'node:url';
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(PORT, () => {
    console.log(`================================================================`);
    console.log(`🚀 Launcher Serverless Runtime listening on port ${PORT}`);
    console.log(`⚡ Zero-Dependency Isolated Worker Engine`);
    console.log(`📊 Stats Endpoint: http://localhost:${PORT}/api/stats`);
    console.log(`📦 Deploy Endpoint: POST http://localhost:${PORT}/api/deploy`);
    console.log(`🌐 Sample Module: http://localhost:${PORT}/abce`);
    console.log(`================================================================`);
  });
}
