import { createPostgresStore } from "./database.js";
import { createRabbitPublisher } from "./queue.js";

const pollIntervalMs = Number(process.env.OUTBOX_POLL_INTERVAL_MS ?? 1000);
const store = createPostgresStore();
const publisher = createRabbitPublisher();
let shuttingDown = false;

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function relay() {
  console.log("Outbox relay started");
  while (!shuttingDown) {
    try {
      const events = await store.getPendingOutboxEvents();
      for (const event of events) {
        if (shuttingDown) break;
        const published = await publisher.publishItemCreated(event.payload);
        if (!published) break;
        await store.markOutboxPublished(event.event_id);
        console.log(`Published outbox event ${event.event_id}`);
      }
      await wait(events.length === 0 ? pollIntervalMs : 100);
    } catch (error) {
      console.error(`Outbox relay failed: ${error.message}`);
      await wait(pollIntervalMs);
    }
  }
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Outbox relay received ${signal}`);
  await Promise.all([store.close(), publisher.close()]);
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

void relay();
