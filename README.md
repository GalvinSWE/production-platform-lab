# Production Platform Lab

Lab tổng quát để quan sát các thành phần của một hệ thống production và cách chúng kết nối với nhau.

## Giai đoạn hiện tại

- Generic HTTP API with PostgreSQL access
- Health check và deployment identity
- Automated tests
- Immutable Docker image
- Database readiness, item read/write endpoints, and schema migration
- Coordinated database connection/query timeouts for fast readiness failures
- Shared Redis cache with cache-aside reads and write invalidation
- Graceful cache degradation and PostgreSQL pool recovery after connection loss
- Durable RabbitMQ events and an acknowledged background worker
- Transactional outbox relay and idempotent item creation
- S3-compatible object storage with PostgreSQL file metadata
- Reproducible multi-container deployment with Docker Compose
- Isolated Staging and Production Compose projects
- Prometheus application metrics for traffic, latency, cache, and Node.js runtime
- Prometheus, Grafana, Node Exporter, and cAdvisor monitoring stack
- Loki and Alloy centralized logging
- Tempo and OpenTelemetry distributed tracing
- Automated PostgreSQL backup and recovery exercises
- File-based runtime secrets and secret rotation
- Pinned container image digests
- HTTPS gateway and host/network hardening
- Azure Pipelines validation and immutable image packaging

Giai đoạn tiếp theo bổ sung triển khai staging tự động, smoke test, production approval và rollback trong Azure Pipelines.
