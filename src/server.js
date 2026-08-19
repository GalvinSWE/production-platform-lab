import { createApp } from "./app.js";
import { createRedisCache } from "./cache.js";
import { createPostgresStore } from "./database.js";
import { createObjectStorage } from "./object-storage.js";

const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? 4000);
const store = createPostgresStore();
const cache = createRedisCache();
const objectStorage = createObjectStorage();
void cache.connect();
void objectStorage.ensureBucket().catch((error) => {
  console.error(`Object storage unavailable at startup: ${error.message}`);
});
const app = createApp({ store, cache, objectStorage });

const server = app.listen(port, host, () => {
  console.log(`Platform API listening on http://${host}:${port}`);
});

function shutdown(signal) {
  console.log(`Received ${signal}; stopping gracefully`);
  server.close(async (error) => {
    await Promise.all([store.close(), cache.close()]);
    objectStorage.close();
    process.exit(error ? 1 : 0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
