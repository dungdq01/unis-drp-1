-- Migration 003: pac_uploaded_dataset + pac_uploaded_line
-- Run after 001_create_plan_actual_tables.sql

CREATE TABLE IF NOT EXISTS pac_uploaded_dataset (
  dataset_id  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(100)  NOT NULL,
  type        VARCHAR(20)   NOT NULL CHECK (type IN ('FORECAST', 'ACTUAL')),
  row_count   INT           NOT NULL DEFAULT 0,
  created_by  VARCHAR(100),
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pac_uploaded_line (
  id             BIGSERIAL    PRIMARY KEY,
  dataset_id     UUID         NOT NULL REFERENCES pac_uploaded_dataset(dataset_id) ON DELETE CASCADE,
  item_code      VARCHAR(50)  NOT NULL,
  location_code  VARCHAR(50)  NOT NULL,
  period_start   DATE         NOT NULL,
  qty            NUMERIC(14,4) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pac_upload_line_ds   ON pac_uploaded_line (dataset_id);
CREATE INDEX IF NOT EXISTS idx_pac_upload_line_sku  ON pac_uploaded_line (dataset_id, item_code, location_code, period_start);
