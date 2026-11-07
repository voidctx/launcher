# ▲ Vanilla Next.js (Zero NPM Packages)

> **A native Next.js-style runtime engine and application built from scratch with ZERO npm packages.**  
> Powered purely by native Node.js ESM (`node:http`, `node:crypto`, `node:fs`, `node:path`), pure HTML5, CSS3, and modern Vanilla JavaScript.

**Author:** Srinibas Das  
**Context:** 7th Semester B.Tech Project  
**Repository Architecture:** Native Next.js Paradigm with Integrated Auth, Security, Token Bucket Rate Limiting & Developer Console

---

## ⚡ Key Highlights

- **0 NPM Packages / 0 `node_modules`:** Zero third-party dependencies. No build steps, no Webpack/Babel, no bundler overhead. Instant zero-latency boot.
- **File-Based Pages Routing (`pages/`):** Automatic URL mapping for `.html` and `.mjs` files (`pages/about.html` $\to$ `/about`, `pages/index.html` $\to$ `/`).
- **File-Based API Routes (`pages/api/`):** Serverless-style API route handlers exporting `export default async function handler(req, res)` with `res.status().json()`.
- **Server-Side Rendering (SSR):** Native `getServerSideProps` support for dynamic server rendering (`pages/dashboard.mjs`).
- **Static Assets Serving (`public/`):** Streaming static files from `public/` (CSS, JS, icons) with correct MIME types and caching headers.
- **Native Session Auth & Scrypt:** Password hashing using Node's native `scrypt`, 32-byte crypto session IDs, `HttpOnly`/`SameSite=Lax` cookies, and CSRF token protection.
- **Token Bucket Rate Limiting:** Built-in multi-tier rate limiter (per-user, per-API-key, and per-service) generating standard HTTP 429 and `Retry-After` headers.
- **Host & Request Security:** Host header sanitization, directory traversal blocks, header size/CRLF filters, and module execution timeouts.

---

## 📁 Repository Structure

```text
├── launcher.mjs              # Main server entry point (HTTP server + router)
├── package.json              # Zero dependencies ("type": "module")
├── run.bat                   # 1-click startup script for Windows Command Prompt
├── run.ps1                   # 1-click startup script for PowerShell
│
├── pages/                    # Next.js File-Based Pages & API Routes
│   ├── index.html            # / (Homepage: feature highlights & live API sandbox)
│   ├── about.html            # /about (Framework architecture & comparison)
│   ├── login.html            # /login (Sign In & Account Creation UI)
│   ├── dashboard.mjs         # /dashboard (SSR Developer Console)
│   ├── 404.html              # Custom 404 Not Found Page
│   ├── 500.html              # Custom 500 Internal Error Page
│   └── api/                  # Next.js API Routes (JSON / REST)
│       ├── hello.mjs         # /api/hello (Sample Next.js API handler)
│       ├── auth.mjs          # /api/auth (Login, Signup, Logout, Key Rotation)
│       ├── ratelimit.mjs     # /api/ratelimit (Token bucket statistics & burst hit)
│       ├── services.mjs      # /api/services (Deploy and manage microservices)
│       └── logs.mjs          # /api/logs (Live invocation history)
│
├── public/                   # Next.js Static Asset Directory
│   ├── style.css             # Dark-themed responsive CSS design
│   └── app.js                # Client-side utility library (CSRF, toasts)
│
├── src/                      # Core Vanilla Next.js Engine (Srinibas Systems)
│   ├── router.mjs            # File-based router (pages, api, static, SSR)
│   ├── context.mjs           # Next.js context helper (req.query, res.status, res.json)
│   ├── auth.mjs              # Scrypt hashing, 32-byte sessions, CSRF
│   ├── apikey.mjs            # API key generation (lnch_...) and rotation
│   ├── ratelimit.mjs         # Token Bucket rate limiter algorithm
│   ├── security.mjs          # Host/path sanitization, CRLF check, timeouts
│   └── store.mjs             # In-memory and persistent JSON store
│
├── modules/                  # Deployed dynamic ESM microservice modules
│   └── abce.mjs              # Sample service at /abce
│
└── tests/
    └── test_all.mjs          # Automated test suite (13 passing tests)
```

---

## 🚀 How to Run

### Using the Bundled Portable Runtime
```powershell
# Windows PowerShell
.\run.ps1

# Or Windows Command Prompt
run.bat

# Or directly with Node.js
node launcher.mjs
```

### Access URLs
- **Homepage:** [http://localhost:3000/](http://localhost:3000/)
- **About Page:** [http://localhost:3000/about](http://localhost:3000/about)
- **Sign In / Sign Up:** [http://localhost:3000/login](http://localhost:3000/login)
- **SSR Dashboard:** [http://localhost:3000/dashboard](http://localhost:3000/dashboard)
- **API Route:** [http://localhost:3000/api/hello](http://localhost:3000/api/hello)
- **Legacy Microservice:** [http://localhost:3000/abce](http://localhost:3000/abce)

---

## 🧪 Running Automated Tests

Run the test suite with:
```powershell
node tests/test_all.mjs
```
Expected output:
```text
Test Results: 13 passed, 0 failed.
```

---

## 🔑 Default Credentials
- **Username:** `srinibas`
- **Password:** `password123`
