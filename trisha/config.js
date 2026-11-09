// config.js - Global configuration for Launcher Admin Module
module.exports = {
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  COOKIE_SECRET: process.env.COOKIE_SECRET || 'launcher_super_secret_cookie_vault_key',
  SESSION_COOKIE_NAME: 'launcher_admin_session',
  SESSION_TTL_MS: 24 * 60 * 60 * 1000, // 24 hours
  
  // Default Initial Admin Credentials
  DEFAULT_ADMIN: {
    username: process.env.ADMIN_USER || 'admin',
    password: process.env.ADMIN_PASSWORD || 'admin123',
    email: 'admin@launcher.local',
    role: 'admin'
  }
};
