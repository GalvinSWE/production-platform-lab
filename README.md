# Production Platform Lab

A reproducible Node.js platform for practicing the operational concerns that appear after an API moves beyond a single process and database.

The lab focuses on correctness, failure recovery, observability, and controlled delivery rather than product-specific business features.

## Architecture

```text
HTTPS gateway
      │
      ├─ API instance 1 ─┐
      └─ API instance 2 ─┼─ PostgreSQL
                         ├─ Redis cache
outbox relay ─ RabbitMQ ─┼─ background workers
                         └─ S3-compatible object storage

applications ─ OpenTelemetry ─ Tempo
applications ─ Prometheus metrics ─ Grafana
containers   ─ Alloy logs ─ Loki
```

## Engineering concerns demonstrated

- PostgreSQL readiness, connection/query timeouts, schema migrations, and backup recovery
- Cache-aside reads, write invalidation, and graceful Redis degradation
- Transactional outbox delivery and idempotent item creation
- Durable RabbitMQ events and acknowledged background processing
- S3-compatible object storage with PostgreSQL metadata
- Prometheus metrics, Grafana dashboards, Loki logs, and Tempo traces
- File-based runtime secrets and secret rotation
- Immutable, digest-pinned container images
- Isolated staging and production Compose projects
- Automated validation, staging rollout, production approval, smoke tests, and rollback

## Source verification

```bash
npm ci
npm test
docker build -t production-platform-api:local .
```

The automated tests exercise health/readiness endpoints, deployment identity, metrics, idempotent writes, cache invalidation, outbox behavior, and file upload/download flows without requiring the full platform.

## Full environment

Running the complete platform requires environment files, local secret files, TLS material, external Docker networks, and persistent volumes. Example environment files are included; real credentials and certificates are intentionally excluded.

See the [Production Runbook](operations/PRODUCTION-RUNBOOK.md) for deployment, smoke testing, monitoring, rollback, backup, recovery, and incident-closeout procedures.

## Delivery flow

```text
feature branch
  → pull request to develop
  → tests and immutable image build
  → staging rollout and smoke test
  → pull request to main
  → manual production approval
  → rolling deployment
  → HTTPS smoke test
  → success or automatic rollback
```

## Safety

- Real `.env` files, passwords, private keys, certificates, backups, and image archives are ignored.
- The checked-in environment files contain paths and non-sensitive local defaults only.
- This repository is a lab environment, not a template that should be deployed unchanged to the public internet.
