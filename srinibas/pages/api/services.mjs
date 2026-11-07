import fs from 'node:fs';
import path from 'node:path';
import { getSessionFromRequest, validateCsrf } from '../../src/auth.mjs';
import { validateServiceName } from '../../src/security.mjs';
import { Store } from '../../src/store.mjs';

/** /api/services — GET list, POST deploy, DELETE remove */
export default async function handler(req, res) {
  const session = getSessionFromRequest(req);
  const user = session ? Store.getUserById(session.userId) : null;
  if (!user) return res.status(401).json({ error: 'Auth required' });

  // LIST
  if (req.method === 'GET')
    return res.json({ services: Store.getUserServices(user.id) });

  // DEPLOY
  if (req.method === 'POST') {
    if (!validateCsrf(req, session)) return res.status(403).json({ error: 'CSRF failed' });
    const body = JSON.parse(req.body || '{}');
    if (!validateServiceName(body.name)) return res.status(400).json({ error: 'Bad service name' });
    if (!body.code?.includes('export default')) return res.status(400).json({ error: 'Must export default' });

    const dir = path.resolve(process.cwd(), 'modules');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, body.name + '.mjs'), body.code, 'utf-8');
    const svc = Store.saveService({ name: body.name, userId: user.id, code: body.code, createdAt: Date.now(), invocations: 0 });
    return res.status(201).json({ ok: true, service: svc });
  }

  // DELETE
  if (req.method === 'DELETE') {
    if (!validateCsrf(req, session)) return res.status(403).json({ error: 'CSRF failed' });
    const name = req.query.name;
    const svc = Store.getService(name);
    if (!svc) return res.status(404).json({ error: 'Not found' });
    if (svc.userId !== user.id && user.role !== 'admin') return res.status(403).json({ error: 'Forbidden' });
    Store.deleteService(name);
    const fp = path.resolve(process.cwd(), 'modules', name + '.mjs');
    if (fs.existsSync(fp)) try { fs.unlinkSync(fp); } catch {}
    return res.json({ ok: true });
  }

  res.status(405).json({ error: 'Method Not Allowed' });
}
