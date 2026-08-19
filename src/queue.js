import amqp from "amqplib";
import { createConnectionUrl, readSecret } from "./secrets.js";

export const itemCreatedQueue = "item.created";

export function createRabbitPublisher({
  url = resolveRabbitUrl(),
  queueName = itemCreatedQueue,
} = {}) {
  if (!url) throw new Error("RABBITMQ_URL is required");

  let connection;
  let channel;

  async function getChannel() {
    if (channel) return channel;

    connection = await amqp.connect(url, { timeout: 1000 });
    connection.on("error", (error) => {
      console.error(`RabbitMQ connection error: ${error.message}`);
    });
    connection.on("close", () => {
      connection = undefined;
      channel = undefined;
    });

    channel = await connection.createConfirmChannel();
    await channel.assertQueue(queueName, { durable: true });
    return channel;
  }

  return {
    async publishItemCreated(event) {
      try {
        const activeChannel = await getChannel();
        activeChannel.sendToQueue(
          queueName,
          Buffer.from(JSON.stringify(event)),
          { persistent: true, contentType: "application/json" },
        );
        await activeChannel.waitForConfirms();
        return true;
      } catch (error) {
        console.error(`RabbitMQ publish failed: ${error.message}`);
        channel = undefined;
        connection = undefined;
        return false;
      }
    },

    async close() {
      if (channel) await channel.close().catch(() => {});
      if (connection) await connection.close().catch(() => {});
    },
  };
}

export function resolveRabbitUrl() {
  if (process.env.RABBITMQ_URL) return process.env.RABBITMQ_URL;

  return createConnectionUrl({
    protocol: "amqp",
    username: process.env.RABBITMQ_USER ?? "platform",
    password: readSecret({
      value: process.env.RABBITMQ_PASSWORD,
      file: process.env.RABBITMQ_PASSWORD_FILE,
      name: "RabbitMQ password",
    }),
    hostname: process.env.RABBITMQ_HOST ?? "rabbitmq",
    port: process.env.RABBITMQ_PORT ?? "5672",
  });
}
