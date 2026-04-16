-- Migration 004: BUG-02 — allocation_leg table for multi-source traceability
-- Each allocation_result row that pulls from N sources gets N leg rows.
-- Old data backfilled with source='UNKNOWN' (can't reconstruct from layer_trace retroactively).

-- 1. Create allocation_leg table
CREATE TABLE IF NOT EXISTS allocation_leg (
  id                    BIGSERIAL PRIMARY KEY,
  allocation_result_id  BIGINT        NOT NULL REFERENCES allocation_result(id) ON DELETE CASCADE,
  source_location_code  VARCHAR(20)   NOT NULL,
  qty                   NUMERIC(15,2) NOT NULL CHECK (qty > 0),
  source_priority       INT           NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- 2. Indexes for FK lookup and analytics
CREATE INDEX IF NOT EXISTS idx_alloc_leg_result_id ON allocation_leg (allocation_result_id);
CREATE INDEX IF NOT EXISTS idx_alloc_leg_source    ON allocation_leg (source_location_code);

-- 3. Backfill existing allocation_result rows that have qty_allocated > 0
--    Use source_location_code from allocation_result (primary source only),
--    mark priority=0 and note it's backfilled via source_priority sentinel.
--    Rows with source_location_code IS NULL (UNALLOCATED) are skipped.
INSERT INTO allocation_leg (allocation_result_id, source_location_code, qty, source_priority)
SELECT
  id,
  source_location_code,
  qty_allocated,
  COALESCE(source_priority, 0)
FROM allocation_result
WHERE source_location_code IS NOT NULL
  AND qty_allocated > 0
  AND NOT EXISTS (
    SELECT 1 FROM allocation_leg al WHERE al.allocation_result_id = allocation_result.id
  );
