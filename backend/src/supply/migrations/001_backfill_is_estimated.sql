-- BUG-01 Backfill: set is_estimated đúng cho snapshot lines 7 ngày gần nhất
-- Logic: is_estimated = true nếu source_type = 'DISTRIBUTION' trong lot_attribute

UPDATE supply_snapshot_line ssl
SET is_estimated = la_agg.has_distribution
FROM (
  SELECT
    item_code,
    location_code,
    BOOL_OR(source_type = 'DISTRIBUTION') AS has_distribution
  FROM lot_attribute
  WHERE quality_status = 'ALLOCATABLE'
  GROUP BY item_code, location_code
) la_agg
WHERE ssl.item_code = la_agg.item_code
  AND ssl.location_code = la_agg.location_code
  AND ssl.snapshot_id IN (
    SELECT id FROM supply_snapshot
    WHERE capture_at >= NOW() - INTERVAL '7 days'
  );

-- Verify
SELECT
  COUNT(*) FILTER (WHERE is_estimated = false) AS oem_lines,
  COUNT(*) FILTER (WHERE is_estimated = true)  AS estimated_lines
FROM supply_snapshot_line
WHERE snapshot_id IN (
  SELECT id FROM supply_snapshot
  WHERE capture_at >= NOW() - INTERVAL '7 days'
);
