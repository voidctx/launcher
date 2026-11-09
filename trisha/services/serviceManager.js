// services/serviceManager.js - Core registry & lifecycle manager for services
const fs = require('fs');
const path = require('path');

class ServiceManager {
  constructor() {
    this.services = new Map();
    this.seedSampleServices();
  }

  seedSampleServices() {
    this.registerService({
      id: 'auth-service',
      name: 'Authentication & Session Service',
      uriPrefix: '/svc/auth',
      headerMatch: 'x-service: auth',
      handlerFile: './sample-services/hello-service.js',
      description: 'Handles token issuance and identity verification',
      memoryCapMb: 32,
      securityStatus: 'approved'
    });

    this.registerService({
      id: 'billing-service',
      name: 'Payment & Billing Engine',
      uriPrefix: '/svc/billing',
      headerMatch: 'x-service: billing',
      handlerFile: './sample-services/math-service.js',
      description: 'Stripe webhook listener and invoice generator',
      memoryCapMb: 48,
      securityStatus: 'approved'
    });

    this.registerService({
      id: 'ai-summarizer',
      name: 'Document Analysis Pipeline',
      uriPrefix: '/svc/summarizer',
      headerMatch: 'x-service: summarizer',
      handlerFile: './sample-services/hello-service.js',
      description: 'Heavy NLP microservice - high candidate for lazy eviction',
      memoryCapMb: 96,
      securityStatus: 'flagged'
    });

    this.loadService('auth-service');
  }

  registerService(serviceData) {
    const id = serviceData.id || `svc-${Date.now().toString(36)}`;
    
    if (this.services.has(id)) {
      throw new Error(`Service with ID '${id}' is already registered.`);
    }

    for (const [_, existing] of this.services) {
      if (serviceData.uriPrefix && existing.uriPrefix === serviceData.uriPrefix) {
        throw new Error(`URI prefix '${serviceData.uriPrefix}' is already reserved by '${existing.name}'.`);
      }
    }

    const newService = {
      id,
      name: serviceData.name || id,
      uriPrefix: serviceData.uriPrefix.startsWith('/') ? serviceData.uriPrefix : `/${serviceData.uriPrefix}`,
      headerMatch: serviceData.headerMatch || '',
      handlerFile: serviceData.handlerFile || './sample-services/hello-service.js',
      description: serviceData.description || 'Microservice hosted on Launcher single port',
      memoryCapMb: Number(serviceData.memoryCapMb) || 32,
      securityStatus: serviceData.securityStatus || 'approved',
      state: 'evicted',
      memoryBytes: 0,
      memoryMb: 0,
      requestCount: 0,
      lastLoadedAt: null,
      lastAccessedAt: null,
      registeredAt: new Date(),
      updatedAt: new Date()
    };

    this.services.set(id, newService);
    return newService;
  }

  updateService(id, updateData) {
    const service = this.services.get(id);
    if (!service) {
      throw new Error(`Service '${id}' not found.`);
    }

    if (updateData.name) service.name = updateData.name;
    if (updateData.uriPrefix) {
      const prefix = updateData.uriPrefix.startsWith('/') ? updateData.uriPrefix : `/${updateData.uriPrefix}`;
      service.uriPrefix = prefix;
    }
    if (updateData.headerMatch !== undefined) service.headerMatch = updateData.headerMatch;
    if (updateData.handlerFile) service.handlerFile = updateData.handlerFile;
    if (updateData.description) service.description = updateData.description;
    if (updateData.memoryCapMb) service.memoryCapMb = Number(updateData.memoryCapMb);
    if (updateData.securityStatus) service.securityStatus = updateData.securityStatus;

    service.updatedAt = new Date();
    return service;
  }

  removeService(id) {
    const service = this.services.get(id);
    if (!service) {
      throw new Error(`Service '${id}' not found.`);
    }

    if (service.state === 'loaded') {
      this.unloadService(id);
    }

    this.services.delete(id);
    return { id, name: service.name, removed: true };
  }

  loadService(id) {
    const service = this.services.get(id);
    if (!service) {
      throw new Error(`Service '${id}' not found.`);
    }

    if (service.state === 'loaded') {
      return { ...service, alreadyLoaded: true };
    }

    const baselineMb = parseFloat((8.5 + (Math.random() * 4.2)).toFixed(2));
    service.state = 'loaded';
    service.memoryMb = baselineMb;
    service.memoryBytes = Math.round(baselineMb * 1024 * 1024);
    service.lastLoadedAt = new Date();
    service.lastAccessedAt = new Date();

    return service;
  }

  unloadService(id) {
    const service = this.services.get(id);
    if (!service) {
      throw new Error(`Service '${id}' not found.`);
    }

    if (service.state === 'evicted') {
      return { ...service, alreadyEvicted: true };
    }

    service.state = 'evicted';
    service.memoryMb = 0;
    service.memoryBytes = 0;

    return service;
  }

  recordRequest(id) {
    const service = this.services.get(id);
    if (!service) return null;

    if (service.state !== 'loaded') {
      this.loadService(id);
    }

    service.requestCount += 1;
    service.lastAccessedAt = new Date();

    const jitter = (Math.random() * 0.15 - 0.05);
    service.memoryMb = Math.max(5.0, parseFloat((service.memoryMb + jitter).toFixed(2)));
    service.memoryBytes = Math.round(service.memoryMb * 1024 * 1024);

    return service;
  }

  listServices() {
    return Array.from(this.services.values());
  }

  getService(id) {
    return this.services.get(id) || null;
  }

  findServiceForRequest(reqPath, reqHeaders = {}) {
    for (const service of this.services.values()) {
      if (reqPath.startsWith(service.uriPrefix)) {
        return service;
      }
      if (service.headerMatch) {
        const [hKey, hVal] = service.headerMatch.split(':').map(s => s.trim().toLowerCase());
        if (hKey && hVal && reqHeaders[hKey] && reqHeaders[hKey].toLowerCase() === hVal) {
          return service;
        }
      }
    }
    return null;
  }

  getSystemStats() {
    const all = Array.from(this.services.values());
    const totalServices = all.length;
    const loadedServices = all.filter(s => s.state === 'loaded').length;
    const evictedServices = all.filter(s => s.state === 'evicted').length;
    
    const residentMemoryMb = all.reduce((sum, s) => sum + s.memoryMb, 0);
    const totalRequests = all.reduce((sum, s) => sum + s.requestCount, 0);
    
    const alwaysOnEstimatedMemoryMb = totalServices * 65;
    const memorySavedMb = Math.max(0, alwaysOnEstimatedMemoryMb - residentMemoryMb);
    const savingsPercentage = alwaysOnEstimatedMemoryMb > 0 
      ? ((memorySavedMb / alwaysOnEstimatedMemoryMb) * 100).toFixed(1) 
      : 0;

    const processMem = process.memoryUsage();

    return {
      totalServices,
      loadedServices,
      evictedServices,
      residentMemoryMb: parseFloat(residentMemoryMb.toFixed(2)),
      estimatedAlwaysOnMb: alwaysOnEstimatedMemoryMb,
      memorySavedMb: parseFloat(memorySavedMb.toFixed(2)),
      savingsPercentage: Number(savingsPercentage),
      totalRequests,
      gatewayRssMb: parseFloat((processMem.rss / (1024 * 1024)).toFixed(2)),
      gatewayHeapUsedMb: parseFloat((processMem.heapUsed / (1024 * 1024)).toFixed(2)),
      nodeVersion: process.version,
      uptimeSeconds: Math.floor(process.uptime())
    };
  }
}

module.exports = new ServiceManager();
