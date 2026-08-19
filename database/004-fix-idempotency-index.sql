DROP INDEX IF EXISTS items_idempotency_key_unique;

CREATE UNIQUE INDEX items_idempotency_key_unique
  ON items (idempotency_key);
