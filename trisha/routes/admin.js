// routes/admin.js - Protected Admin APIs for Service Orchestration
const express = require('express');
const router = express.Router();
const serviceManager = require('../services/serviceManager');
const { requireAdmin } = require('../middleware/auth');

router.use(requireAdmin);

router.get('/services', (req, res) => {
  const services = serviceManager.listServices();
  return res.json({
    success: true,
    count: services.length,
    services
  });
});

router.get('/services/:id', (req, res) => {
  const service = serviceManager.getService(req.params.id);
  if (!service) {
    return res.status(404).json({ success: false, error: `Service '${req.params.id}' not found` });
  }
  return res.json({ success: true, service });
});

router.post('/services', (req, res) => {
  try {
    const { id, name, uriPrefix, headerMatch, handlerFile, description, memoryCapMb, securityStatus } = req.body;

    if (!name || !uriPrefix) {
      return res.status(400).json({
        success: false,
        error: 'Fields "name" and "uriPrefix" are required.'
      });
    }

    const registered = serviceManager.registerService({
      id,
      name,
      uriPrefix,
      headerMatch,
      handlerFile,
      description,
      memoryCapMb,
      securityStatus
    });

    return res.status(201).json({
      success: true,
      message: `Service '${registered.name}' registered successfully`,
      service: registered
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      error: err.message
    });
  }
});

router.put('/services/:id', (req, res) => {
  try {
    const updated = serviceManager.updateService(req.params.id, req.body);
    return res.json({
      success: true,
      message: `Service '${updated.name}' updated successfully`,
      service: updated
    });
  } catch (err) {
    return res.status(400).json({
      success: false,
      error: err.message
    });
  }
});

router.delete('/services/:id', (req, res) => {
  try {
    const result = serviceManager.removeService(req.params.id);
    return res.json({
      success: true,
      message: `Service '${result.name}' successfully removed`,
      result
    });
  } catch (err) {
    return res.status(404).json({
      success: false,
      error: err.message
    });
  }
});

router.post('/services/:id/load', (req, res) => {
  try {
    const service = serviceManager.loadService(req.params.id);
    return res.json({
      success: true,
      message: `Service '${service.name}' is now LOADED in memory`,
      service
    });
  } catch (err) {
    return res.status(404).json({
      success: false,
      error: err.message
    });
  }
});

router.post('/services/:id/unload', (req, res) => {
  try {
    const service = serviceManager.unloadService(req.params.id);
    return res.json({
      success: true,
      message: `Service '${service.name}' has been UNLOADED (EVICTED) from memory`,
      service
    });
  } catch (err) {
    return res.status(404).json({
      success: false,
      error: err.message
    });
  }
});

router.get('/system/stats', (req, res) => {
  const stats = serviceManager.getSystemStats();
  return res.json({
    success: true,
    stats
  });
});

router.post('/services/:id/simulate-request', (req, res) => {
  const service = serviceManager.recordRequest(req.params.id);
  if (!service) {
    return res.status(404).json({ success: false, error: 'Service not found' });
  }
  return res.json({
    success: true,
    message: `Dispatched request to '${service.name}' (State: ${service.state}, Total: ${service.requestCount})`,
    service
  });
});

module.exports = router;
