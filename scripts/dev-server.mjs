/**
 * Local dashboard server. Static files plus the real /api handlers on in-memory PGlite.
 * Does not read .env.local and does not connect to Neon.
 *
 *   npm run dev:local
 *   npm run dev:local -- --persist
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { migrate } from '../db/migrate.js';
import { setDbAdapter } from '../api/_lib/db.js';
import authHandler from '../api/auth.js';
import dataHandler from '../api/data.js';
import importsHandler from '../api/imports.js';
import templatesHandler from '../api/templates.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = 3100;
const persist = process.argv.includes('--persist');
const devPassword = process.env.ADMIN_PASSWORD || 'dev-admin-password';
const devSecret = process.env.SESSION_SECRET || 'dev-session-secret-value';

process.env.ADMIN_PASSWORD = devPassword;
process.env.SESSION_SECRET = devSecret;
process.env.DATABASE_URL = 'postgres://dev:dev@127.0.0.1/sas_dev';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
};

const routes = {
  '/api/auth': authHandler,
  '/api/data': dataHandler,
  '/api/imports': importsHandler,
  '/api/templates': templatesHandler,
};

async function bootDatabase() {
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = persist ? new PGlite(join(tmpdir(), 'sas-dashboard-pglite')) : new PGlite();
  const adapter = {
    async query(text, params = []) {
      const result = await pg.query(text, params);
      return { rows: result.rows };
    },
    async transaction(fn) {
      return pg.transaction(async (tx) => fn({
        async query(text, params = []) {
          const result = await tx.query(text, params);
          return { rows: result.rows };
        },
      }));
    },
    async close() {
      await pg.close();
    },
  };
  await migrate(adapter);
  setDbAdapter(adapter);
  return adapter;
}

function safeFile(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  // Never serve dotfiles such as .env.local (database URL, admin password) or .vercel/.
  if (relative.split('/').some((segment) => segment.startsWith('.'))) return null;
  const full = normalize(join(root, relative));
  if (full !== root && !full.startsWith(`${root}/`)) return null;
  return full;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const route = routes[url.pathname];
    if (route) {
      await route(req, res);
      return;
    }
    const file = safeFile(url.pathname);
    if (!file) {
      res.statusCode = 400;
      res.end('Bad path');
      return;
    }
    const body = await readFile(file);
    res.statusCode = 200;
    res.setHeader('Content-Type', TYPES[extname(file)] || 'application/octet-stream');
    res.end(body);
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      res.statusCode = 404;
      res.end('Not found');
      return;
    }
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end('Server error');
    }
  }
});

await bootDatabase();
server.listen(port, '127.0.0.1', () => {
  console.log(`SAS dashboard local dev http://localhost:${port}`);
  console.log(`ADMIN_PASSWORD=${devPassword}`);
  console.log(`SESSION_SECRET=${devSecret}`);
  console.log(persist ? `database: PGlite at ${join(tmpdir(), 'sas-dashboard-pglite')}` : 'database: in-memory PGlite (not Neon)');
});
