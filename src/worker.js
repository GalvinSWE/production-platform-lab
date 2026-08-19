import amqp from "amqplib";
import { createPostgresStore } from "./database.js";
import { itemCreatedQueue, resolveRabbitUrl } from "./queue.js";

const rabbitUrl = resolveRabbitUrl();
const workerId = process.env.WORKER_ID ?? `worker-${process.pid}`;
const delayMs = Number(process.env.WORKER_DELAY_MS ?? 1500);

if (!rabbitUrl) throw new Error("RABBITMQ_URL is required");

const store = createPostgresStore();
let connection;
let channel;
let shuttingDown = false;

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function consume() {
  while (!shuttingDown) {
    try {
      connection = await amqp.connect(rabbitUrl);
      channel = await connection.createChannel();
      await channel.assertQueue(itemCreatedQueue, { durable: true });
      await channel.prefetch(1);

      console.log(`${workerId} waiting for messages`);
      await channel.consume(itemCreatedQueue, async (message) => {
        if (!message) return;

        try {
          const event = JSON.parse(message.content.toString());
          console.log(`${workerId} processing ${event.eventId}`);
          await wait(delayMs);
          await store.recordProcessedJob({
            eventId: event.eventId,
            itemId: event.itemId,
            workerId,
          });
          channel.ack(message);
          console.log(`${workerId} acknowledged ${event.eventId}`);
        } catch (error) {
          console.error(`${workerId} failed: ${error.message}`);
          channel.nack(message, false, true);
        }
      });

      await new Promise((resolve) => connection.once("close", resolve));
    } catch (error) {
      if (!shuttingDown) {
        console.error(`${workerId} connection failed: ${error.message}`);
        await wait(3000);
      }
    }
  }
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${workerId} received ${signal}`);
  if (channel) await channel.close().catch(() => {});
  if (connection) await connection.close().catch(() => {});
  await store.close();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

void consume();
