import pg from "pg";
import { createConnectionUrl, readSecret } from "./secrets.js";

const { Pool } = pg;

export function createPostgresStore({
  connectionString = resolveDatabaseUrl(),
  maxConnections = Number(process.env.DB_POOL_SIZE ?? 10),
  connectionTimeoutMillis = Number(
    process.env.DB_CONNECTION_TIMEOUT_MS ?? 1500,
  ),
  queryTimeoutMillis = Number(process.env.DB_QUERY_TIMEOUT_MS ?? 2000),
} = {}) {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required");
  }

  const poolOptions = {
    connectionString,
    max: maxConnections,
    connectionTimeoutMillis,
    query_timeout: queryTimeoutMillis,
  };
  let pool = new Pool(poolOptions);
  let resettingPool;

  function isConnectionFailure(error) {
    return (
      ["ECONNREFUSED", "ECONNRESET", "EPIPE", "57P01"].includes(error.code) ||
      /connection|socket/i.test(error.message)
    );
  }

  function resetPool() {
    if (!resettingPool) {
      const previousPool = pool;
      pool = new Pool(poolOptions);
      resettingPool = previousPool
        .end()
        .catch(() => {})
        .finally(() => {
          resettingPool = undefined;
        });
    }
  }

  async function query(text, parameters) {
    try {
      return await pool.query(text, parameters);
    } catch (error) {
      if (!isConnectionFailure(error)) throw error;
      console.error(`PostgreSQL connection failed; rebuilding pool: ${error.message}`);
      resetPool();
      return pool.query(text, parameters);
    }
  }

  return {
    async checkConnection() {
      await query("SELECT 1");
    },

    async listItems() {
      const result = await query(
        "SELECT id, name, created_at FROM items ORDER BY id",
      );
      return result.rows;
    },

    async createItemWithOutbox({ name, idempotencyKey, eventId }) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        let client;
        let connectionFailed = false;
        try {
          client = await pool.connect();
          await client.query("BEGIN");
          const inserted = await client.query(
            `INSERT INTO items (name, idempotency_key)
             VALUES ($1, $2)
             ON CONFLICT (idempotency_key) DO NOTHING
             RETURNING id, name, created_at, idempotency_key`,
            [name, idempotencyKey],
          );

          if (inserted.rowCount === 0) {
            const existing = await client.query(
              `SELECT id, name, created_at, idempotency_key
               FROM items WHERE idempotency_key = $1`,
              [idempotencyKey],
            );
            await client.query("COMMIT");
            return { item: existing.rows[0], duplicate: true };
          }

          const item = inserted.rows[0];
          await client.query(
            `INSERT INTO outbox_events (event_id, event_type, payload)
             VALUES ($1, 'item.created', $2::jsonb)`,
            [
              eventId,
              JSON.stringify({
                eventId,
                itemId: item.id,
                name: item.name,
                createdAt: item.created_at,
              }),
            ],
          );
          await client.query("COMMIT");
          return { item, duplicate: false };
        } catch (error) {
          if (client) await client.query("ROLLBACK").catch(() => {});
          connectionFailed = isConnectionFailure(error);
          if (attempt === 0 && connectionFailed) {
            resetPool();
            continue;
          }
          throw error;
        } finally {
          if (client) client.release(connectionFailed);
        }
      }
      throw new Error("Could not create item");
    },

    async getPendingOutboxEvents(limit = 10) {
      const result = await query(
        `SELECT event_id, event_type, payload
         FROM outbox_events
         WHERE published_at IS NULL
         ORDER BY created_at
         LIMIT $1`,
        [limit],
      );
      return result.rows;
    },

    async markOutboxPublished(eventId) {
      await query(
        `UPDATE outbox_events
         SET published_at = NOW(), attempts = attempts + 1
         WHERE event_id = $1`,
        [eventId],
      );
    },

    async createFileMetadata({
      objectKey,
      originalName,
      contentType,
      sizeBytes,
    }) {
      const result = await query(
        `INSERT INTO files (object_key, original_name, content_type, size_bytes)
         VALUES ($1, $2, $3, $4)
         RETURNING id, object_key, original_name, content_type, size_bytes, created_at`,
        [objectKey, originalName, contentType, sizeBytes],
      );
      return result.rows[0];
    },

    async listFiles() {
      const result = await query(
        `SELECT id, object_key, original_name, content_type, size_bytes, created_at
         FROM files ORDER BY id`,
      );
      return result.rows;
    },

    async getFileMetadata(id) {
      const result = await query(
        `SELECT id, object_key, original_name, content_type, size_bytes, created_at
         FROM files WHERE id = $1`,
        [id],
      );
      return result.rows[0] ?? null;
    },

    async recordProcessedJob({ eventId, itemId, workerId }) {
      await query(
        `INSERT INTO processed_jobs (event_id, item_id, worker_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (event_id) DO NOTHING`,
        [eventId, itemId, workerId],
      );
    },

    async close() {
      await pool.end();
    },
  };
}

function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;

  return createConnectionUrl({
    protocol: "postgresql",
    username: process.env.DB_USER ?? "platform",
    password: readSecret({
      value: process.env.DB_PASSWORD,
      file: process.env.DB_PASSWORD_FILE,
      name: "database password",
    }),
    hostname: process.env.DB_HOST ?? "postgres",
    port: process.env.DB_PORT ?? "5432",
    database: process.env.DB_NAME ?? "platform",
  });
}
