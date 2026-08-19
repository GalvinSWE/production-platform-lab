import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createApp } from "../src/app.js";

let server;
let baseUrl;
let items;
let cachedItems;
let outboxEvents;
let itemsByKey;
let files;
let storedObjects;

before(async () => {
  items = [];
  cachedItems = null;
  outboxEvents = [];
  itemsByKey = new Map();
  files = [];
  storedObjects = new Map();
  const store = {
    async checkConnection() {},
    async listItems() {
      return items.map(({ id, name, created_at }) => ({ id, name, created_at }));
    },
    async createItemWithOutbox({ name, idempotencyKey, eventId }) {
      if (itemsByKey.has(idempotencyKey)) {
        return { item: itemsByKey.get(idempotencyKey), duplicate: true };
      }
      const item = {
        id: items.length + 1,
        name,
        created_at: "test-time",
        idempotency_key: idempotencyKey,
      };
      items.push(item);
      itemsByKey.set(idempotencyKey, item);
      outboxEvents.push({ eventId, itemId: item.id });
      return { item, duplicate: false };
    },
  };
  const cache = {
    async getItems() {
      return cachedItems;
    },
    async setItems(value) {
      cachedItems = value;
    },
    async invalidateItems() {
      cachedItems = null;
    },
  };
  store.createFileMetadata = async ({
    objectKey,
    originalName,
    contentType,
    sizeBytes,
  }) => {
    const file = {
      id: files.length + 1,
      object_key: objectKey,
      original_name: originalName,
      content_type: contentType,
      size_bytes: sizeBytes,
      created_at: "test-time",
    };
    files.push(file);
    return file;
  };
  store.listFiles = async () => files;
  store.getFileMetadata = async (id) =>
    files.find((file) => String(file.id) === String(id)) ?? null;
  const objectStorage = {
    async putObject({ key, body, contentType }) {
      storedObjects.set(key, { body, contentType });
    },
    async getObject(key) {
      return storedObjects.get(key).body;
    },
  };
  const app = createApp({
    instanceId: "test-instance",
    environment: "test",
    version: "test-version",
    store,
    cache,
    objectStorage,
  });
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("GET /health reports the running instance", async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-instance-id"), "test-instance");
  assert.deepEqual(await response.json(), {
    status: "healthy",
    instanceId: "test-instance",
    environment: "test",
    version: "test-version",
  });
});

test("GET /whoami exposes deployment identity", async () => {
  const response = await fetch(`${baseUrl}/whoami`);
  const body = await response.json();
  assert.equal(body.instanceId, "test-instance");
  assert.equal(body.environment, "test");
  assert.equal(body.version, "test-version");
  assert.equal(typeof body.pid, "number");
});

test("GET /ready reports database readiness", async () => {
  const response = await fetch(`${baseUrl}/ready`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: "ready",
    database: "connected",
    instanceId: "test-instance",
  });
});

test("GET /metrics exposes application and HTTP metrics", async () => {
  await fetch(`${baseUrl}/health`);
  const response = await fetch(`${baseUrl}/metrics`);
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /platform_http_requests_total/);
  assert.match(body, /platform_process_resident_memory_bytes/);
  assert.match(body, /instance="test-instance"/);
  assert.match(body, /environment="test"/);
});

test("POST /items creates data and GET /items reads it", async () => {
  const createdResponse = await fetch(`${baseUrl}/items`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": "test-create-1",
    },
    body: JSON.stringify({ name: "first item" }),
  });
  assert.equal(createdResponse.status, 201);
  const createdBody = await createdResponse.json();
  assert.equal(createdBody.item.name, "first item");
  assert.equal(createdBody.eventStored, true);
  assert.equal(createdBody.duplicate, false);
  assert.equal(outboxEvents.length, 1);

  const listResponse = await fetch(`${baseUrl}/items`);
  assert.equal(listResponse.status, 200);
  const firstList = await listResponse.json();
  assert.equal(firstList.cache, "miss");
  assert.deepEqual(firstList.items, [
    { id: 1, name: "first item", created_at: "test-time" },
  ]);

  const cachedResponse = await fetch(`${baseUrl}/items`);
  assert.equal((await cachedResponse.json()).cache, "hit");
});

test("POST /items invalidates cached item lists", async () => {
  assert.notEqual(cachedItems, null);
  await fetch(`${baseUrl}/items`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": "test-create-2",
    },
    body: JSON.stringify({ name: "second item" }),
  });
  assert.equal(cachedItems, null);
});

test("POST /items returns the original item for a repeated key", async () => {
  const response = await fetch(`${baseUrl}/items`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": "test-create-1",
    },
    body: JSON.stringify({ name: "first item" }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.item.id, 1);
  assert.equal(body.duplicate, true);
  assert.equal(outboxEvents.length, 2);
});

test("POST /items rejects an empty name", async () => {
  const response = await fetch(`${baseUrl}/items`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": "empty-name-test",
    },
    body: JSON.stringify({ name: "   " }),
  });
  assert.equal(response.status, 400);
});

test("a file uploaded through one request can be listed and downloaded", async () => {
  const form = new FormData();
  form.append("file", new Blob(["hello storage"]), "hello.txt");
  const uploadResponse = await fetch(`${baseUrl}/files`, {
    method: "POST",
    body: form,
  });
  assert.equal(uploadResponse.status, 201);
  const uploaded = await uploadResponse.json();
  assert.equal(uploaded.file.original_name, "hello.txt");

  const listResponse = await fetch(`${baseUrl}/files`);
  assert.equal((await listResponse.json()).files.length, 1);

  const downloadResponse = await fetch(`${baseUrl}/files/1`);
  assert.equal(downloadResponse.status, 200);
  assert.equal(await downloadResponse.text(), "hello storage");
});
