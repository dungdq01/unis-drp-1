-- Drop cái cũ (có thể chưa có data quan trọng — đây là Sprint 0)
DROP TABLE IF EXISTS allocation_leg CASCADE;

-- Recreate đúng spec
CREATE TABLE allocation_leg (
  id                    BIGSERIAL PRIMARY KEY,
  allocation_result_id  BIGINT        NOT NULL REFERENCES allocation_result(id) ON DELETE CASCADE,
  source_type           VARCHAR(20)   NOT NULL,           -- HUB | NM | CN_REDIST | UNKNOWN
  source_entity_id      BIGINT        NOT NULL DEFAULT 0, -- polymorphic FK (0 = unknown/backfill)
  source_lot_id         VARCHAR(50)   NULL,               -- for FIFO tracking
  allocated_qty         DECIMAL(15,2) NOT NULL CHECK (allocated_qty > 0),
  fifo_rank             INT           NULL,               -- thứ tự FIFO khi pick
  distance_km           DECIMAL(10,2) NULL,               -- distance CN→CN cho LCNB
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_alloc_leg_result  ON allocation_leg(allocation_result_id);
CREATE INDEX idx_alloc_leg_source  ON allocation_leg(source_type, source_entity_id);

-- Backfill: đánh dấu tất cả allocation_result cũ có qty > 0 là UNKNOWN
INSERT INTO allocation_leg (allocation_result_id, source_type, source_entity_id, allocated_qty)
SELECT id, 'UNKNOWN', 0, qty_allocated
FROM allocation_result
WHERE qty_allocated > 0
  AND NOT EXISTS (
    SELECT 1 FROM allocation_leg al WHERE al.allocation_result_id = allocation_result.id
  );
