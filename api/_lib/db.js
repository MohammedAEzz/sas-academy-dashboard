import { Pool, neon } from "@neondatabase/serverless";
import { AppError } from "./errors.js";

let override = null;
let neonAdapter = null;

export function setDbAdapter(adapter) {
  override = adapter;
  neonAdapter = null;
}

export function getDb() {
  if (override) return override;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString || !String(connectionString).trim()) {
    throw new AppError("CONFIG", "Server is missing required configuration: DATABASE_URL", 500);
  }
  if (!neonAdapter) neonAdapter = createNeonAdapter(connectionString);
  return neonAdapter;
}

export function createNeonAdapter(connectionString) {
  // Stand-alone reads use Neon's HTTP driver (one round trip, no WebSocket handshake);
  // the WebSocket Pool is opened lazily and only for interactive transactions.
  const http = neon(connectionString);
  let pool = null;
  const wrap = (runner) => ({
    async query(text, params = []) {
      const result = await runner.query(text, params);
      return { rows: result.rows };
    },
  });
  return {
    async query(text, params = []) {
      return { rows: await http.query(text, params) };
    },
    async transaction(fn) {
      if (!pool) pool = new Pool({ connectionString });
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const value = await fn(wrap(client));
        await client.query("COMMIT");
        return value;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          /* The original error is the one to surface. */
        }
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      if (pool) await pool.end();
    },
  };
}
