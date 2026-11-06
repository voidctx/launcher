import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'launcher_store.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// In-memory state
const state = {
  users: {},      // userId -> user
  usersByName: {}, // username -> userId
  apiKeys: {},    // apiKey -> userId
  sessions: {},   // sessionId -> session
  services: {},   // serviceName -> service
  logs: []        // request logs (capped at 500)
};

// Load database if exists
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
  } catch (err) {
    console.error('Failed to load database from disk, using fresh state:', err.message);
  }
}

// Persist database to disk
function saveDatabase() {
  try {
    const payload = JSON.stringify({
      users: state.users,
      usersByName: state.usersByName,
      apiKeys: state.apiKeys,
      sessions: state.sessions,
      services: state.services,
      logs: state.logs.slice(-200) // keep last 200 logs on disk
    }, null, 2);
    fs.writeFileSync(DB_FILE, payload, 'utf-8');
  } catch (err) {
    console.error('Failed to save database to disk:', err.message);
  }
}

loadDatabase();

export const Store = {
  // Users
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
    state.users[user.id] = user;
    state.usersByName[user.username.toLowerCase()] = user.id;
    if (user.apiKey) {
      state.apiKeys[user.apiKey] = user.id;
    }
    saveDatabase();
    return user;
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

  // Sessions
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

  // Services
  getService(name) {
    return state.services[name] || null;
  },
  getUserServices(userId) {
    return Object.values(state.services).filter(s => s.userId === userId);
  },
  getAllServices() {
    return Object.values(state.services);
  },
  saveService(service) {
    state.services[service.name] = service;
    saveDatabase();
    return service;
  },
  deleteService(name) {
    if (state.services[name]) {
      delete state.services[name];
      saveDatabase();
      return true;
    }
    return false;
  },
  incrementServiceInvocation(name) {
    if (state.services[name]) {
      state.services[name].invocations = (state.services[name].invocations || 0) + 1;
      state.services[name].lastInvokedAt = Date.now();
      saveDatabase();
    }
  },

  // Logs
  addLog(entry) {
    const log = {
      id: crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(8).toString('hex'),
      timestamp: Date.now(),
      ...entry
    };
    state.logs.push(log);
    if (state.logs.length > 500) {
      state.logs.shift();
    }
    return log;
  },
  getUserLogs(userId, limit = 50) {
    const userServices = new Set(this.getUserServices(userId).map(s => s.name));
    return state.logs
      .filter(l => l.userId === userId || userServices.has(l.serviceName))
      .slice(-limit)
      .reverse();
  },
  getRecentLogs(limit = 50) {
    return state.logs.slice(-limit).reverse();
  }
};
