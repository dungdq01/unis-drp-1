-- =============================================================================
-- Migration 003: Demand Accuracy — FINAL model vs MA3 baseline
-- =============================================================================
-- Module:  Module 1 — Forecast Accuracy Dashboard
-- Spec:    docs/report-module1/ACCURACY-DASHBOARD-SPEC.md
-- Data:    data/demand-forecast/summary_accuracy_FINAL_vs_MA3.csv (1,660 SKUs)
--          data/demand-forecast/full_accuracy_T10_T11_T12_T1_forecast_T2_T3.csv
-- Depends: 001_master_data.sql (item table)
-- =============================================================================

BEGIN;

CREATE TABLE demand_accuracy (
    id                  BIGSERIAL PRIMARY KEY,
    fsku                VARCHAR(50) NOT NULL,

    -- Actuals (T10 Oct 2025 ... T1 Jan 2026)
    actual_t10          DECIMAL(15,2),
    actual_t11          DECIMAL(15,2),
    actual_t12          DECIMAL(15,2),
    actual_t1           DECIMAL(15,2),

    -- FINAL model forecast (Dec 2025 onward; T2/T3 are live-looking)
    final_fc_t12        DECIMAL(15,2),
    final_fc_t1         DECIMAL(15,2),
    final_fc_t2         DECIMAL(15,2),
    final_fc_t3         DECIMAL(15,2),

    -- MA3 baseline forecast (3-month moving average)
    ma3_fc_t12          DECIMAL(15,2),
    ma3_fc_t1           DECIMAL(15,2),

    -- Accuracy % per method (NULL when actual is missing)
    acc_final_t12       DECIMAL(5,2),
    acc_ma3_t12         DECIMAL(5,2),
    acc_final_t1        DECIMAL(5,2),
    acc_ma3_t1          DECIMAL(5,2),

    -- WMA backtest (from full_accuracy file — T10/T11 only)
    wma_t10             DECIMAL(15,2),
    wma_t11             DECIMAL(15,2),
    acc_wma_t10         DECIMAL(5,2),
    acc_wma_t11         DECIMAL(5,2),

    -- Flag: CAIO manually modified forecast
    is_modified         BOOLEAN DEFAULT FALSE,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- FK to item master — FK optional (allow load before master is reconciled).
    -- Uncomment after master seed includes all 1,660 FSKUs.
    -- CONSTRAINT fk_accuracy_item FOREIGN KEY (fsku) REFERENCES item(item_code),
    CONSTRAINT uq_accuracy_fsku UNIQUE (fsku)
);

CREATE INDEX idx_acc_fsku         ON demand_accuracy(fsku);
CREATE INDEX idx_acc_final_t1     ON demand_accuracy(acc_final_t1);
CREATE INDEX idx_acc_actual_t1    ON demand_accuracy(actual_t1);
CREATE INDEX idx_acc_final_t12    ON demand_accuracy(acc_final_t12);

COMMIT;
