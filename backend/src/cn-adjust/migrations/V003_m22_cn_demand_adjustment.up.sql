-- ============================================================
-- Migration: V003_m22_cn_demand_adjustment.up.sql
-- Module: M22 — CN Demand Adjustment & Trust Score
-- DA: DA2 · Sprint 3
-- ============================================================

-- ─── 1. reason_code (lookup) ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reason_code (
  code       VARCHAR(50)   PRIMARY KEY,
  label_vi   VARCHAR(200)  NOT NULL,
  is_active  BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP     NOT NULL DEFAULT NOW()
);

-- Seed 6 default reason codes (idempotent — from M10 cn_adjust.reason_codes config)
INSERT INTO reason_code (code, label_vi) VALUES
  ('NEW_PROJECT',      'Dự án mới phát sinh'),
  ('PROJECT_DELAY',    'Dự án bị delay / dời tiến độ'),
  ('COMPETITOR_PROMO', 'Đối thủ tung khuyến mãi'),
  ('OWN_PROMO',        'Khuyến mãi nội bộ'),
  ('WEATHER',          'Yếu tố thời tiết / mùa vụ'),
  ('OTHER',            'Lý do khác')
ON CONFLICT (code) DO NOTHING;

-- ─── 2. trust_score ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS trust_score (
  cn_id                     BIGINT       PRIMARY KEY,   -- FK channel.id
  score                     DECIMAL(5,2) NOT NULL DEFAULT 100.00,
  total_adjustments_12w     INT          NOT NULL DEFAULT 0,
  accurate_adjustments_12w  INT          NOT NULL DEFAULT 0,
  last_calculated_at        TIMESTAMP    NULL,
  is_grace_period           BOOLEAN      NOT NULL DEFAULT TRUE,
  CONSTRAINT fk_trust_score_channel FOREIGN KEY (cn_id) REFERENCES channel(id) ON DELETE CASCADE
);

-- ─── 3. cn_adjust_audit_log ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cn_adjust_audit_log (
  id            BIGSERIAL     PRIMARY KEY,
  adjustment_id BIGINT        NULL,          -- FK cn_demand_adjustment (nullable for force without prior row)
  cn_id         BIGINT        NOT NULL,
  sku_id        BIGINT        NOT NULL,
  action        VARCHAR(30)   NOT NULL,      -- SUBMIT | APPROVE | REJECT | FORCE | EXPIRE
  old_status    VARCHAR(30)   NULL,
  new_status    VARCHAR(30)   NOT NULL,
  actor         VARCHAR(100)  NOT NULL,
  reason_text   TEXT          NULL,
  created_at    TIMESTAMP     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cn_audit_adj ON cn_adjust_audit_log (adjustment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cn_audit_cn  ON cn_adjust_audit_log (cn_id, created_at DESC);

-- ─── 4. cn_demand_adjustment ─────────────────────────────────────────────────
-- NOTE: UPDATE-before-INSERT pattern bắt buộc (spec §6 re-submit transaction order)
-- để tránh unique violation với partial unique index bên dưới.

CREATE TABLE IF NOT EXISTS cn_demand_adjustment (
  id            BIGSERIAL      PRIMARY KEY,
  cn_id         BIGINT         NOT NULL,
  sku_id        BIGINT         NOT NULL,
  period_date   DATE           NOT NULL,     -- luôn là Monday của tuần (spec §6b)
  fc_qty        DECIMAL(15,2)  NOT NULL,     -- FC gốc snapshot tại lúc submit
  adjusted_qty  DECIMAL(15,2)  NOT NULL,
  delta_pct     DECIMAL(7,4)   NOT NULL,     -- (adjusted-fc)/fc*100
  reason_code   VARCHAR(50)    NOT NULL,
  reason_text   TEXT           NULL,         -- mandatory khi delta > tolerance hoặc force
  status        VARCHAR(20)    NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING','AUTO_APPROVED','APPROVED','REJECTED','FORCE_APPROVED','EXPIRED')),
  submitted_by  VARCHAR(100)   NOT NULL,
  submitted_at  TIMESTAMP      NOT NULL DEFAULT NOW(),
  reviewed_by   VARCHAR(100)   NULL,
  reviewed_at   TIMESTAMP      NULL,
  review_note   TEXT           NULL,
  actual_qty    DECIMAL(15,2)  NULL,         -- Phase 2: backfill từ M28
  is_accurate   BOOLEAN        NULL,         -- Phase 2: |adj-actual|/actual <= 20%
  created_at    TIMESTAMP      NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_cn_adj_channel FOREIGN KEY (cn_id) REFERENCES channel(id) ON DELETE RESTRICT,
  CONSTRAINT fk_cn_adj_sku     FOREIGN KEY (sku_id) REFERENCES sku(id)     ON DELETE RESTRICT,
  CONSTRAINT fk_cn_adj_reason  FOREIGN KEY (reason_code) REFERENCES reason_code(code) ON DELETE RESTRICT
);

-- Partial unique: chỉ 1 active adjustment per (cn × sku × week) (spec §6 C1 fix)
-- EXPIRED/REJECTED không block re-submit
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_adj
  ON cn_demand_adjustment (cn_id, sku_id, period_date)
  WHERE status IN ('PENDING','AUTO_APPROVED','APPROVED','FORCE_APPROVED');

-- Query indexes
CREATE INDEX IF NOT EXISTS idx_cn_adj_cn_period
  ON cn_demand_adjustment (cn_id, period_date DESC);

CREATE INDEX IF NOT EXISTS idx_cn_adj_status_period
  ON cn_demand_adjustment (status, period_date DESC);

-- M23 DRP effective demand query (hot path)
CREATE INDEX IF NOT EXISTS idx_cn_adj_period_status
  ON cn_demand_adjustment (period_date, status)
  WHERE status IN ('AUTO_APPROVED','APPROVED','FORCE_APPROVED');

-- ─── Feature flag seed (BUG-4 fix) ───────────────────────────────────────────
INSERT INTO feature_flag (flag_name, enabled, description)
VALUES ('m22_cn_demand_adjust_enabled', TRUE, 'M22 CN Demand Adjustment & Trust Score')
ON CONFLICT (flag_name) DO NOTHING;
