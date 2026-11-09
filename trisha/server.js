// server.js - Launcher Gateway & Admin Management Server
const express = require('express');
const cookieParser = require('cookie-parser');
const path = require('path');
const config = require('./config');
const serviceManager = require('./services/serviceManager');

const authRoutes = require('./routes/auth');
const adminRoutes = require('./routes/admin');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser(config.COOKIE_SECRET));

app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/admin', authRoutes);
app.use('/api/admin', adminRoutes);

// Single-Port Dynamic Gateway Dispatch Handler
app.all(['/svc/*', '/service/*'], (req, res) => {
  const service = serviceManager.findServiceForRequest(req.path, req.headers);

  if (!service) {
    return res.status(404).json({
      error: 'Gateway Routing Error',
      message: `No microservice registered for URI '${req.path}' on port ${config.PORT}`,
      registeredServices: serviceManager.listServices().map(s => ({ id: s.id, uri: s.uriPrefix }))
    });
  }

  const updatedService = serviceManager.recordRequest(service.id);

  res.setHeader('X-Served-By-Gateway', 'Launcher-SinglePort');
  res.setHeader('X-Service-Id', updatedService.id);
  res.setHeader('X-Service-State', updatedService.state);

  return res.json({
    gateway: 'Launcher Single-Port Architecture',
    port: config.PORT,
    service: {
      id: updatedService.id,
      name: updatedService.name,
      uri: updatedService.uriPrefix,
      state: updatedService.state,
      residentMemoryMb: updatedService.memoryMb,
      requestCount: updatedService.requestCount
    },
    payload: {
      message: `Successfully executed ${updatedService.name}`,
      method: req.method,
      query: req.query,
      body: req.body
    }
  });
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'Endpoint not found' });
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error('[Launcher Admin Error]', err);
  res.status(500).json({
    success: false,
    error: err.message || 'Internal Server Error'
  });
});

if (require.main === module) {
  app.listen(config.PORT, () => {
    console.log('================================================================');
    console.log(`🚀 Launcher Admin Gateway Server running on port ${config.PORT}`);
    console.log(`📊 Admin Dashboard: http://localhost:${config.PORT}`);
    console.log(`🔑 Default Admin Credentials:`);
    console.log(`   Username: ${config.DEFAULT_ADMIN.username}`);
    console.log(`   Password: ${config.DEFAULT_ADMIN.password}`);
    console.log(`⚡ Test Services lazy-loading on single port:`);
    console.log(`   http://localhost:${config.PORT}/svc/auth`);
    console.log(`   http://localhost:${config.PORT}/svc/billing`);
    console.log(`   http://localhost:${config.PORT}/svc/summarizer`);
    console.log('================================================================');
  });
}

module.exports = app;
