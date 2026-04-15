BEGIN;

CREATE TABLE IF NOT EXISTS plan_actual_comparison (
  id               BIGSERIAL      PRIMARY KEY,
  computed_at      TIMESTAMP      NOT NULL DEFAULT NOW(),
  comparison_type  VARCHAR(30)    NOT NULL,
  period_start     DATE           NOT NULL,
  period_end       DATE           NOT NULL,
  period_type      VARCHAR(10)    NOT NULL DEFAULT 'MONTHLY',
  item_code        VARCHAR(50)    NOT NULL,
  location_code    VARCHAR(20)    NOT NULL,
  snapshot_id_base VARCHAR(36)    NOT NULL,
  snapshot_id_compare VARCHAR(36) NULL,
  plan_qty         DECIMAL(15,2)  NOT NULL DEFAULT 0,
  actual_qty       DECIMAL(15,2)  NULL,
  variance_qty     DECIMAL(15,2)  NULL,
  variance_pct     DECIMAL(10,4)  NULL,
  fill_rate_proxy  DECIMAL(10,4)  NULL,
  status           VARCHAR(20)    NOT NULL DEFAULT 'ON_TARGET',
  computed_by      VARCHAR(100)   NULL
);

CREATE INDEX IF NOT EXISTS idx_pac_item        ON plan_actual_comparison(item_code);
CREATE INDEX IF NOT EXISTS idx_pac_location    ON plan_actual_comparison(location_code);
CREATE INDEX IF NOT EXISTS idx_pac_period      ON plan_actual_comparison(period_start);
CREATE INDEX IF NOT EXISTS idx_pac_type        ON plan_actual_comparison(comparison_type);
CREATE INDEX IF NOT EXISTS idx_pac_computed_at ON plan_actual_comparison(computed_at DESC);
CREATE INDEX IF NOT EXISTS idx_pac_snap_base   ON plan_actual_comparison(snapshot_id_base);
CREATE INDEX IF NOT EXISTS idx_pac_status      ON plan_actual_comparison(status);

COMMIT;
