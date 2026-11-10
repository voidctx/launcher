import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
import * as pages from './pages.mjs';
import http from 'http';

const PORT = 65535;
let reloadToken = Date.now();
const cxt = Object.getOwnPropertyNames(globalThis)
  .reduce((acc, key) => {
    acc[key] = globalThis[key];
    return acc;
  }, {});
// register('./resolve.mjs', pathToFileURL('./'));

setInterval(() => {
  reloadToken = Date.now();;
}, 60_000);

async function runServer(uuid,name,req,res,pages){
	globalThis.process = undefined;
	globalThis.require = undefined;
	globalThis.buffer = undefined;
	const mod = await import(`./modules/${name}.mjs?update=${reloadToken}`);
	if (!mod.default?.server || typeof mod.default.server !== 'function') {
      res.writeHead(500);
      res.end('Module missing valid server()');
      return;
    }
    return await mod.default.server(req,pages.tg);
}

const server = http.createServer(async (req, res) => {
  const urlPath = new URL(req.url, `http://${req.headers.host}`).pathname;
  const name = urlPath.slice(1);
  if (!name) {
    res.writeHead(400);
    res.end(pages.e400);
    return;
  }
  if(name.startsWith("favicon.ico")){ return false; }
  try {
    const result = await runServer(req.headers['uuid'],name,req,res,pages);
    res.writeHead(result.status ?? 200, result.headers ?? {});
    res.end(result.body ?? '');
  } catch (err) {
    console.log(err);
    if (err.code === 'ERR_MODULE_NOT_FOUND' || err.message.includes('Cannot find module')) {
      res.writeHead(404);
      res.end(pages.e404);
    } else {
      const page = await pages.genError('500',err);
      res.writeHead(500);
      res.end(page);
      // res.end(pages.error.replace('{err}',err));
    }
  }
});

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}/`);
});
