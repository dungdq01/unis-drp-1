BEGIN;

DROP TABLE IF EXISTS allocation_result CASCADE;
DROP TABLE IF EXISTS allocation_run CASCADE;

CREATE TABLE allocation_run (
  id                    BIGSERIAL    PRIMARY KEY,
  plan_run_id           BIGINT       NOT NULL,
  status                VARCHAR(20)  NOT NULL DEFAULT 'RUNNING',
  total_demand_lines    INT          NOT NULL DEFAULT 0,
  total_allocated       INT          NOT NULL DEFAULT 0,
  total_partial         INT          NOT NULL DEFAULT 0,
  total_unallocated     INT          NOT NULL DEFAULT 0,
  fill_rate_overall     DECIMAL(5,4) DEFAULT NULL,
  fill_rate_a           DECIMAL(5,4) DEFAULT NULL,
  fill_rate_b           DECIMAL(5,4) DEFAULT NULL,
  fill_rate_c           DECIMAL(5,4) DEFAULT NULL,
  config_snapshot       JSONB        DEFAULT NULL,
  error_message         TEXT         DEFAULT NULL,
  created_by            VARCHAR(100) DEFAULT NULL,
  duration_ms           INT          DEFAULT NULL,
  started_at            TIMESTAMP    DEFAULT NULL,
  completed_at          TIMESTAMP    DEFAULT NULL,
  created_at            TIMESTAMP    NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_allocation_run_plan   ON allocation_run(plan_run_id);
CREATE INDEX idx_allocation_run_status ON allocation_run(status);

CREATE TABLE allocation_result (
  id                       BIGSERIAL     PRIMARY KEY,
  allocation_run_id        BIGINT        NOT NULL REFERENCES allocation_run(id),
  planned_order_id         BIGINT        NOT NULL,
  item_code                VARCHAR(50)   NOT NULL,
  source_location_code     VARCHAR(20)   DEFAULT NULL,
  dest_location_code       VARCHAR(20)   NOT NULL DEFAULT '',
  lot_number               VARCHAR(50)   NOT NULL DEFAULT 'LOT_ATTR',
  qty_required             DECIMAL(15,2) NOT NULL DEFAULT 0,
  qty_allocated            DECIMAL(15,2) NOT NULL DEFAULT 0,
  fill_rate                DECIMAL(5,4)  DEFAULT NULL,
  abc_class                CHAR(1)       DEFAULT NULL,
  source_priority          INT           NOT NULL DEFAULT 1,
  status                   VARCHAR(20)   NOT NULL DEFAULT 'UNALLOCATED',
  layer_trace              JSONB         NOT NULL DEFAULT '{}',
  week_number              INT           NOT NULL DEFAULT 1,
  created_at               TIMESTAMP     NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_alloc_result_run    ON allocation_result(allocation_run_id);
CREATE INDEX idx_alloc_result_item   ON allocation_result(item_code, dest_location_code);
CREATE INDEX idx_alloc_result_status ON allocation_result(status);
CREATE INDEX idx_alloc_result_abc    ON allocation_result(abc_class);
CREATE INDEX idx_alloc_result_dest   ON allocation_result(dest_location_code);

COMMIT;
