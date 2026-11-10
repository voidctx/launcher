import crypto from 'node:crypto';
import { Store } from './store.mjs';

const KEY_PREFIX = 'lnch_';

export function generateKeyString() {
  return `${KEY_PREFIX}${crypto.randomBytes(24).toString('hex')}`;
}

export function generateApiKeyForUser(userId) {
  const user = Store.getUserById(userId);
  if (!user) throw new Error('User not found');
  const oldKey = user.apiKey;
  const newKey = generateKeyString();
  Store.updateUserApiKey(userId, oldKey, newKey);
  return newKey;
}

export function rotateApiKeyForUser(userId) {
  const user = Store.getUserById(userId);
  if (!user) throw new Error('User not found');
  const oldKey = user.apiKey;
  const newKey = generateKeyString();
  Store.updateUserApiKey(userId, oldKey, newKey);
  return {
    userId,
    oldKey,
    newKey,
    rotatedAt: Date.now()
  };
}

export function extractApiKey(req) {
  const headerKey = req.headers['x-api-key'];
  if (headerKey && typeof headerKey === 'string') {
    return headerKey.trim();
  }
  const authHeader = req.headers['authorization'];
  if (authHeader && typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  return null;
}

export function authenticateApiKey(req) {
  const apiKey = extractApiKey(req);
  if (!apiKey) return null;
  const user = Store.getUserByApiKey(apiKey);
  if (!user) return null;
  return {
    user,
    apiKey
  };
}
