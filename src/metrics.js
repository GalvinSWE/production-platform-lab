import {
  Counter,
  Histogram,
  Registry,
  collectDefaultMetrics,
} from "prom-client";

export function createMetrics({ instanceId, environment }) {
  const registry = new Registry();
  registry.setDefaultLabels({ instance: instanceId, environment });
  collectDefaultMetrics({ register: registry, prefix: "platform_" });

  const requests = new Counter({
    name: "platform_http_requests_total",
    help: "Total HTTP requests handled by the API",
    labelNames: ["method", "route", "status_code"],
    registers: [registry],
  });

  const duration = new Histogram({
    name: "platform_http_request_duration_seconds",
    help: "HTTP request duration in seconds",
    labelNames: ["method", "route", "status_code"],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [registry],
  });

  const cacheReads = new Counter({
    name: "platform_cache_reads_total",
    help: "Item cache read results",
    labelNames: ["result"],
    registers: [registry],
  });

  return {
    middleware(request, response, next) {
      const stopTimer = duration.startTimer();
      response.on("finish", () => {
        const labels = {
          method: request.method,
          route: request.route?.path ?? request.path,
          status_code: String(response.statusCode),
        };
        requests.inc(labels);
        stopTimer(labels);
      });
      next();
    },

    cacheRead(result) {
      cacheReads.inc({ result });
    },

    contentType: registry.contentType,
    render() {
      return registry.metrics();
    },
  };
}
