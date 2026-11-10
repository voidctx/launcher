function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function genError(status, err) {
  const safeStatus = escapeHtml(String(status));
  const safeErr = escapeHtml(String((err && err.message) || err || 'Unknown error'));
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${safeStatus} - Error</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; text-align: center; padding: 60px 20px; background: #0f172a; color: #f8fafc; }
    .card { max-width: 600px; margin: 0 auto; background: #1e293b; border-radius: 12px; padding: 32px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.3); border: 1px solid #334155; }
    h1 { color: #f43f5e; margin-bottom: 12px; font-size: 2rem; }
    pre { background: #090d16; padding: 16px; border-radius: 8px; text-align: left; overflow-x: auto; color: #cbd5e1; font-size: 0.9rem; border: 1px solid #1e293b; }
    p { color: #94a3b8; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${safeStatus}</h1>
    <p>The server encountered an issue processing your request.</p>
    <pre>${safeErr}</pre>
  </div>
</body>
</html>`;
}

export const homePage = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Launcher Serverless Runtime</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; text-align: center; padding: 60px 20px; background: #0f172a; color: #f8fafc; }
    .card { max-width: 680px; margin: 0 auto; background: #1e293b; border-radius: 12px; padding: 36px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.3); border: 1px solid #334155; }
    h1 { color: #38bdf8; margin-bottom: 12px; font-size: 2.2rem; }
    p { color: #94a3b8; line-height: 1.6; }
    .badge { display: inline-block; background: #0369a1; color: #e0f2fe; padding: 4px 12px; border-radius: 9999px; font-size: 0.85rem; font-weight: 600; margin-bottom: 16px; }
    .endpoint { background: #090d16; padding: 12px 16px; border-radius: 8px; text-align: left; font-family: monospace; color: #a5f3fc; margin: 12px 0; border: 1px solid #334155; }
  </style>
</head>
<body>
  <div class="card">
    <span class="badge">Isolated Serverless Engine</span>
    <h1>Launcher Edge Gateway</h1>
    <p>A multi-tenant serverless execution engine running on native Node.js worker isolates with memory ceilings, hardware watchdogs, and per-request telemetry.</p>
    <div class="endpoint">GET /:serviceName &rarr; Dispatch to worker</div>
    <div class="endpoint">GET /api/stats &rarr; Live system and service telemetry metrics</div>
  </div>
</body>
</html>`;

export const e400 = genError(400, 'Bad Request - Missing or invalid service identifier');
export const e404 = genError(404, 'Service Not Found');
export const e500 = genError(500, 'Internal Server Error');
