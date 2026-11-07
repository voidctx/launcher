import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const BASE = process.cwd();
const PAGES = path.join(BASE, 'pages');
const PUBLIC = path.join(BASE, 'public');

const MIME = {
  '.html': 'text/html',        '.css': 'text/css',
  '.js':   'text/javascript',  '.mjs': 'text/javascript',
  '.json': 'application/json', '.png': 'image/png',
  '.jpg':  'image/jpeg',       '.ico': 'image/x-icon',
  '.svg':  'image/svg+xml',    '.txt': 'text/plain',
};

/* ── helpers ────────────────────────────────────────────── */

function findPage(dir, segments) {
  if (!fs.existsSync(dir)) return null;
  const params = {};

  for (let i = 0; i < segments.length; i++) {
    const seg   = segments[i];
    const last  = i === segments.length - 1;
    const items = fs.readdirSync(dir);

    if (last) {
      for (const ext of ['.mjs', '.js', '.html']) {
        if (items.includes(seg + ext))
          return { file: path.join(dir, seg + ext), ext, params };
      }
      // check sub-dir index
      const sub = path.join(dir, seg);
      if (items.includes(seg) && fs.statSync(sub).isDirectory()) {
        for (const ext of ['.mjs', '.js', '.html']) {
          if (fs.readdirSync(sub).includes('index' + ext))
            return { file: path.join(sub, 'index' + ext), ext, params };
        }
      }
      // dynamic [param]
      const dyn = items.find(f => /^\[(\w+)\]\.(mjs|js|html)$/.test(f));
      if (dyn) {
        const [, p, e] = dyn.match(/^\[(\w+)\]\.(mjs|js|html)$/);
        params[p] = decodeURIComponent(seg);
        return { file: path.join(dir, dyn), ext: '.' + e, params };
      }
      return null;
    }

    // intermediate directory
    if (items.includes(seg) && fs.statSync(path.join(dir, seg)).isDirectory()) {
      dir = path.join(dir, seg);
    } else {
      const dynDir = items.find(f => /^\[\w+\]$/.test(f) && fs.statSync(path.join(dir, f)).isDirectory());
      if (dynDir) { params[dynDir.slice(1,-1)] = decodeURIComponent(seg); dir = path.join(dir, dynDir); }
      else return null;
    }
  }

  // root index
  if (segments.length === 0 && fs.existsSync(dir)) {
    for (const ext of ['.mjs', '.js', '.html']) {
      if (fs.readdirSync(dir).includes('index' + ext))
        return { file: path.join(dir, 'index' + ext), ext, params };
    }
  }
  return null;
}

function enhance(req, res, url, params) {
  // req helpers
  req.query = Object.fromEntries(url.searchParams);
  Object.assign(req.query, params);
  req.body = null;

  // res helpers
  res.status = (code) => { res.statusCode = code; return res; };

  res.json = (data) => {
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'application/json');
      res.writeHead(res.statusCode || 200);
    }
    res.end(JSON.stringify(data));
  };

  res.send = (body) => {
    if (!res.headersSent) res.writeHead(res.statusCode || 200);
    res.end(typeof body === 'object' ? JSON.stringify(body) : body);
  };

  res.html = (html) => {
    if (!res.headersSent) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.writeHead(res.statusCode || 200);
    }
    res.end(html);
  };

  res.redirect = (loc, code) => {
    res.writeHead(code || 302, { Location: loc });
    res.end();
  };
}

async function parseBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', () => resolve(''));
  });
}

/* ── main router ────────────────────────────────────────── */

export async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  // 1. Static files from public/
  if (pathname !== '/') {
    const staticPath = path.join(PUBLIC, pathname.replace(/^\//, ''));
    if (staticPath.startsWith(PUBLIC) && fs.existsSync(staticPath) && fs.statSync(staticPath).isFile()) {
      const ext = path.extname(staticPath).toLowerCase();
      const content = fs.readFileSync(staticPath);
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'public, max-age=3600'
      });
      res.end(content);
      return;
    }
  }

  // favicon
  if (pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }

  // parse segments
  const segments = pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);

  // 2. API routes — pages/api/...
  if (segments[0] === 'api') {
    const apiSegs = segments.slice(1);
    const match = findPage(path.join(PAGES, 'api'), apiSegs);
    if (match && (match.ext === '.mjs' || match.ext === '.js')) {
      enhance(req, res, url, match.params);
      if (['POST','PUT','PATCH','DELETE'].includes(req.method))
        req.body = await parseBody(req);

      const mod = await import(pathToFileURL(match.file).href + '?t=' + Date.now());
      const handler = mod.default;
      if (typeof handler === 'function') { await handler(req, res); return; }
    }
  }

  // 3. Page routes — pages/...
  const match = findPage(PAGES, segments);
  if (match) {
    enhance(req, res, url, match.params);

    // static HTML page
    if (match.ext === '.html') {
      res.html(fs.readFileSync(match.file, 'utf-8'));
      return;
    }

    // SSR page (.mjs / .js)
    if (match.ext === '.mjs' || match.ext === '.js') {
      const mod = await import(pathToFileURL(match.file).href + '?t=' + Date.now());

      // getServerSideProps support
      let props = {};
      if (typeof mod.getServerSideProps === 'function') {
        const result = await mod.getServerSideProps({ req, res, query: req.query, params: match.params });
        if (result?.redirect) { res.redirect(result.redirect.destination, result.redirect.statusCode || 302); return; }
        if (result?.props) props = result.props;
      }

      if (typeof mod.default === 'function') {
        const html = await mod.default(props, { req, res });
        if (!res.headersSent) res.html(html);
        return;
      }
    }
  }

  // 4. 404
  const custom404 = path.join(PAGES, '404.html');
  res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(fs.existsSync(custom404)
    ? fs.readFileSync(custom404, 'utf-8')
    : '<h1>404 - Not Found</h1>');
}
