import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'launcher_store.json');
const MAX_IN_MEMORY_LOGS = 500;
const MAX_DISK_LOGS = 200;

if (!fs.existsSync(DATA_DIR)) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch {}
}

const state = {
  users: {},        // userId -> user { id, username, passwordHash, role, apiKey, totalRequests, computeTimeMs, createdAt }
  usersByName: {},  // lowercase username -> userId
  apiKeys: {},      // apiKey -> userId
  sessions: {},     // sessionId -> session { id, userId, role, csrfToken, expiresAt, createdAt }
  services: {},     // serviceName -> service { name, userId, code, createdAt, invocations, totalComputeMs, lastInvokedAt }
  logs: []          // ring buffer of recent invocation logs
};

function loadDatabase() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const content = fs.readFileSync(DB_FILE, 'utf-8');
      const data = JSON.parse(content);
      if (data.users) state.users = data.users;
      if (data.usersByName) state.usersByName = data.usersByName;
      if (data.apiKeys) state.apiKeys = data.apiKeys;
      if (data.sessions) state.sessions = data.sessions;
      if (data.services) state.services = data.services;
      if (data.logs) state.logs = data.logs;
    }
  } catch (err) {}
}

let saveScheduled = false;
function saveDatabase() {
  if (saveScheduled) return;
  saveScheduled = true;
  setImmediate(() => {
    saveScheduled = false;
    try {
      const payload = JSON.stringify({
        users: state.users,
        usersByName: state.usersByName,
        apiKeys: state.apiKeys,
        sessions: state.sessions,
        services: state.services,
        logs: state.logs.slice(-MAX_DISK_LOGS)
      }, null, 2);
      fs.writeFileSync(DB_FILE, payload, 'utf-8');
    } catch {}
  });
}

loadDatabase();

export const Store = {
  getUserById(id) {
    return state.users[id] || null;
  },
  getUserByUsername(username) {
    const id = state.usersByName[username?.toLowerCase()];
    return id ? state.users[id] : null;
  },
  getUserByApiKey(apiKey) {
    const id = state.apiKeys[apiKey];
    return id ? state.users[id] : null;
  },
  saveUser(user) {
    const record = {
      totalRequests: 0,
      computeTimeMs: 0,
      tier: 'standard',
      createdAt: Date.now(),
      ...user
    };
    state.users[record.id] = record;
    state.usersByName[record.username.toLowerCase()] = record.id;
    if (record.apiKey) {
      state.apiKeys[record.apiKey] = record.id;
    }
    saveDatabase();
    return record;
  },
  updateUserApiKey(userId, oldKey, newKey) {
    const user = state.users[userId];
    if (!user) return null;
    if (oldKey && state.apiKeys[oldKey]) {
      delete state.apiKeys[oldKey];
    }
    user.apiKey = newKey;
    user.keyUpdatedAt = Date.now();
    state.apiKeys[newKey] = userId;
    saveDatabase();
    return user;
  },
  saveSession(session) {
    state.sessions[session.id] = session;
    saveDatabase();
    return session;
  },
  getSession(id) {
    const session = state.sessions[id];
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
      this.deleteSession(id);
      return null;
    }
    return session;
  },
  deleteSession(id) {
    if (state.sessions[id]) {
      delete state.sessions[id];
      saveDatabase();
      return true;
    }
    return false;
  },
  getService(name) {
    return state.services[name] || null;
  },
  getUserServices(userId) {
    return Object.values(state.services).filter((s) => s.userId === userId);
  },
  getAllServices() {
    return Object.values(state.services);
  },
  saveService(service) {
    const record = {
      invocations: 0,
      totalComputeMs: 0,
      createdAt: Date.now(),
      ...service
    };
    state.services[record.name] = record;
    saveDatabase();
    return record;
  },
  deleteService(name) {
    if (state.services[name]) {
      delete state.services[name];
      saveDatabase();
      return true;
    }
    return false;
  },
  recordInvocation(serviceName, userId, latencyMs = 0) {
    if (state.services[serviceName]) {
      const svc = state.services[serviceName];
      svc.invocations = (svc.invocations || 0) + 1;
      svc.totalComputeMs = (svc.totalComputeMs || 0) + latencyMs;
      svc.lastInvokedAt = Date.now();
    }
    if (userId && state.users[userId]) {
      const u = state.users[userId];
      u.totalRequests = (u.totalRequests || 0) + 1;
      u.computeTimeMs = (u.computeTimeMs || 0) + latencyMs;
    }
    saveDatabase();
  },

  getBillingSummary(userId) {
    const user = state.users[userId];
    if (!user) return null;
    const totalReqs = user.totalRequests || 0;
    const computeMs = user.computeTimeMs || 0;
    const requestCost = (totalReqs / 100_000) * 0.15;
    const computeCost = (computeMs / 1000) * 0.000016;
    const totalCost = Number((requestCost + computeCost).toFixed(4));
    return {
      userId: user.id,
      username: user.username,
      tier: user.tier || 'standard',
      totalRequests: totalReqs,
      computeTimeMs: Math.round(computeMs),
      estimatedCostUsd: totalCost,
      pricing: {
        requestRatePer100k: 0.15,
        includedFreeTierRequests: 10_000
      }
    };
  },

  addLog(entry) {
    const log = {
      id: crypto.randomBytes ? crypto.randomBytes(8).toString('hex') : String(Date.now()),
      timestamp: Date.now(),
      ...entry
    };
    state.logs.push(log);
    if (state.logs.length > MAX_IN_MEMORY_LOGS) {
      state.logs.shift();
    }
    return log;
  },
  getUserLogs(userId, limit = 50) {
    const userServices = new Set(this.getUserServices(userId).map((s) => s.name));
    return state.logs
      .filter((l) => l.userId === userId || userServices.has(l.serviceName))
      .slice(-limit)
      .reverse();
  },
  getRecentLogs(limit = 50) {
    return state.logs.slice(-limit).reverse();
  },

  reset() {
    state.users = {};
    state.usersByName = {};
    state.apiKeys = {};
    state.sessions = {};
    state.services = {};
    state.logs = [];
  }
};
