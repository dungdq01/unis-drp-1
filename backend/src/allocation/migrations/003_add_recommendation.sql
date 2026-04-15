BEGIN;

CREATE TABLE IF NOT EXISTS allocation_recommendation (
  id                  BIGSERIAL    PRIMARY KEY,
  allocation_run_id   BIGINT       NOT NULL,
  type                VARCHAR(40)  NOT NULL DEFAULT 'LCNB_LATERAL_TRANSFER',
  from_location_code  VARCHAR(20)  NOT NULL,
  to_location_code    VARCHAR(20)  NOT NULL,
  item_code           VARCHAR(50)  NOT NULL,
  suggested_qty       DECIMAL(15,2) NOT NULL DEFAULT 0,
  status              VARCHAR(20)  NOT NULL DEFAULT 'PENDING',
  decided_by          VARCHAR(100) DEFAULT NULL,
  decided_at          TIMESTAMP    DEFAULT NULL,
  note                TEXT         DEFAULT NULL,
  created_at          TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_alloc_rec_run    ON allocation_recommendation(allocation_run_id);
CREATE INDEX idx_alloc_rec_status ON allocation_recommendation(status);

COMMIT;
