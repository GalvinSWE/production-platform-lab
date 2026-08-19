import express from "express";
import { randomUUID } from "node:crypto";
import multer from "multer";
import { createMetrics } from "./metrics.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

export function createApp({
  instanceId = process.env.INSTANCE_ID ?? `local-${process.pid}`,
  environment = process.env.APP_ENV ?? "local",
  version = process.env.APP_VERSION ?? "development",
  store,
  cache,
  objectStorage,
  metrics = createMetrics({ instanceId, environment }),
} = {}) {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json());
  app.use(metrics.middleware);
  app.use((_request, response, next) => {
    response.setHeader("x-instance-id", instanceId);
    response.setHeader("x-app-version", version);
    next();
  });

  app.get("/health", (_request, response) => {
    response.json({ status: "healthy", instanceId, environment, version });
  });

  app.get("/whoami", (_request, response) => {
    response.json({ instanceId, environment, version, pid: process.pid });
  });

  app.get("/metrics", async (_request, response, next) => {
    try {
      response.setHeader("content-type", metrics.contentType);
      response.send(await metrics.render());
    } catch (error) {
      next(error);
    }
  });

  app.get("/ready", async (_request, response) => {
    try {
      await store.checkConnection();
      response.json({ status: "ready", database: "connected", instanceId });
    } catch {
      response.status(503).json({
        status: "not-ready",
        database: "disconnected",
        instanceId,
      });
    }
  });

  app.get("/items", async (_request, response, next) => {
    try {
      const cachedItems = await cache.getItems();
      if (cachedItems) {
        metrics.cacheRead("hit");
        return response.json({
          items: cachedItems,
          servedBy: instanceId,
          cache: "hit",
        });
      }

      const items = await store.listItems();
      metrics.cacheRead("miss");
      await cache.setItems(items);
      return response.json({ items, servedBy: instanceId, cache: "miss" });
    } catch (error) {
      return next(error);
    }
  });

  app.post("/items", async (request, response, next) => {
    const name = String(request.body?.name ?? "").trim();
    const idempotencyKey = String(
      request.get("Idempotency-Key") ?? "",
    ).trim();
    if (!name) {
      return response.status(400).json({ error: "name is required" });
    }
    if (!idempotencyKey) {
      return response.status(400).json({ error: "Idempotency-Key is required" });
    }

    try {
      const result = await store.createItemWithOutbox({
        name,
        idempotencyKey,
        eventId: randomUUID(),
      });
      if (!result.duplicate) await cache.invalidateItems();
      return response.status(result.duplicate ? 200 : 201).json({
        item: result.item,
        servedBy: instanceId,
        duplicate: result.duplicate,
        eventStored: true,
      });
    } catch (error) {
      return next(error);
    }
  });

  app.get("/files", async (_request, response, next) => {
    try {
      response.json({ files: await store.listFiles(), servedBy: instanceId });
    } catch (error) {
      next(error);
    }
  });

  app.post("/files", upload.single("file"), async (request, response, next) => {
    if (!request.file) {
      return response.status(400).json({ error: "file is required" });
    }

    const objectKey = `${randomUUID()}-${request.file.originalname}`;
    try {
      await objectStorage.putObject({
        key: objectKey,
        body: request.file.buffer,
        contentType: request.file.mimetype,
      });
      const file = await store.createFileMetadata({
        objectKey,
        originalName: request.file.originalname,
        contentType: request.file.mimetype,
        sizeBytes: request.file.size,
      });
      return response.status(201).json({ file, servedBy: instanceId });
    } catch (error) {
      return next(error);
    }
  });

  app.get("/files/:id", async (request, response, next) => {
    try {
      const file = await store.getFileMetadata(request.params.id);
      if (!file) return response.status(404).json({ error: "file not found" });

      const body = await objectStorage.getObject(file.object_key);
      response.setHeader("content-type", file.content_type);
      response.setHeader("content-length", String(body.length));
      response.setHeader(
        "content-disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(file.original_name)}`,
      );
      return response.send(body);
    } catch (error) {
      return next(error);
    }
  });

  app.use((error, _request, response, _next) => {
    console.error(error);
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      return response.status(413).json({ error: "file exceeds 5 MB limit" });
    }
    response.status(500).json({ error: "internal server error" });
  });

  return app;
}
