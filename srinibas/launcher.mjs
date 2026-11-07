import http from 'node:http';
import { route } from './src/router.mjs';
import { Store } from './src/store.mjs';
import { hashPassword } from './src/auth.mjs';
import { generateApiKeyForUser } from './src/apikey.mjs';

// Seed default dev user if fresh
if (!Store.getUserByUsername('srinibas')) {
  const id = 'usr_' + Date.now();
  Store.saveUser({ id, username: 'srinibas', passwordHash: hashPassword('password123'), role: 'admin', apiKey: null, createdAt: Date.now() });
  generateApiKeyForUser(id);
  Store.saveService({ name: 'abce', userId: id, code: `export default { async server(req) { return { status: 200, headers: { 'Content-Type': 'text/plain' }, body: 'Hello from /abce!' }; } };`, createdAt: Date.now(), invocations: 0 });
}

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;

const server = http.createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (err) {
    console.error(err);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'text/html' });
      res.end('<h1>500 — Internal Server Error</h1>');
    }
  }
});

export { server };

if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, () => {
    console.log(`▲ Vanilla Next.js running at http://localhost:${PORT}`);
  });
}
