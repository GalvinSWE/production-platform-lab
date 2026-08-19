import { createClient } from "redis";

const ITEMS_KEY = "items:v1";

export function createRedisCache({
  url = process.env.REDIS_URL,
  ttlSeconds = Number(process.env.CACHE_TTL_SECONDS ?? 30),
} = {}) {
  if (!url) {
    throw new Error("REDIS_URL is required");
  }

  const client = createClient({
    url,
    disableOfflineQueue: true,
    socket: {
      connectTimeout: 500,
      reconnectStrategy: false,
    },
  });

  let retryTimer;
  let lastErrorLoggedAt = 0;

  function logThrottled(message) {
    const now = Date.now();
    if (now - lastErrorLoggedAt >= 10_000) {
      console.error(message);
      lastErrorLoggedAt = now;
    }
  }

  client.on("error", (error) => {
    logThrottled(`Redis error: ${error.message}`);
  });

  async function attemptConnection() {
    if (client.isOpen) return;
    try {
      await client.connect();
    } catch (error) {
      logThrottled(`Redis unavailable: ${error.message}`);
    }
  }

  async function safely(operation, fallback) {
    if (!client.isReady) return fallback;
    try {
      return await operation();
    } catch (error) {
      console.error(`Redis operation failed: ${error.message}`);
      return fallback;
    }
  }

  return {
    async connect() {
      await attemptConnection();
      retryTimer = setInterval(attemptConnection, 10_000);
      retryTimer.unref();
    },

    async getItems() {
      const value = await safely(() => client.get(ITEMS_KEY), null);
      return value ? JSON.parse(value) : null;
    },

    async setItems(items) {
      await safely(
        () => client.set(ITEMS_KEY, JSON.stringify(items), { EX: ttlSeconds }),
        null,
      );
    },

    async invalidateItems() {
      await safely(() => client.del(ITEMS_KEY), null);
    },

    async close() {
      clearInterval(retryTimer);
      if (client.isOpen) await client.quit().catch(() => client.destroy());
    },
  };
}
