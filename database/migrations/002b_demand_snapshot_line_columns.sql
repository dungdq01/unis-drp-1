BEGIN;
ALTER TABLE demand_snapshot_line
  ADD COLUMN IF NOT EXISTS combo_class       VARCHAR(50),
  ADD COLUMN IF NOT EXISTS branch_archetype  VARCHAR(30),
  ADD COLUMN IF NOT EXISTS tet_flag          CHAR(1),
  ADD COLUMN IF NOT EXISTS confidence_lower  DECIMAL(15,2),
  ADD COLUMN IF NOT EXISTS confidence_upper  DECIMAL(15,2);

CREATE INDEX IF NOT EXISTS idx_dsl_combo ON demand_snapshot_line(combo_class);
CREATE INDEX IF NOT EXISTS idx_dsl_tet ON demand_snapshot_line(tet_flag);
COMMIT;
