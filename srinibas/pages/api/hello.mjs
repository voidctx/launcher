/** GET /api/hello — sample Next.js API route */
export default async function handler(req, res) {
  res.json({
    message: 'Hello from Vanilla Next.js!',
    method: req.method,
    query: req.query,
    npmPackages: 0,
    timestamp: new Date().toISOString()
  });
}
