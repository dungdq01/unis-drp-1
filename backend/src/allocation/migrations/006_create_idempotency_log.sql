CREATE TABLE IF NOT EXISTS idempotency_log (
  key          VARCHAR(64)  PRIMARY KEY,
  endpoint     VARCHAR(200) NOT NULL,
  result_json  JSONB        NOT NULL,
  status_code  INT          NOT NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ  NOT NULL DEFAULT (NOW() + INTERVAL '24 hours')
);

CREATE INDEX idx_idempotency_expires ON idempotency_log(expires_at);
