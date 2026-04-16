-- ============================================================
-- Migration: 20260417_m00_create_master_data_tables.down.sql
-- Description: Drop all master data tables (reverse FK order)
-- ============================================================

-- Drop indexes first
DROP INDEX IF EXISTS uq_customer_primary_cn;

-- Drop tables in reverse FK dependency order
DROP TABLE IF EXISTS customer_cn        CASCADE;
DROP TABLE IF EXISTS transport_lane     CASCADE;
DROP TABLE IF EXISTS carrier            CASCADE;
DROP TABLE IF EXISTS customer_product   CASCADE;
DROP TABLE IF EXISTS customer           CASCADE;
DROP TABLE IF EXISTS bom                CASCADE;
DROP TABLE IF EXISTS warehouse_product  CASCADE;
DROP TABLE IF EXISTS product_supplier   CASCADE;
DROP TABLE IF EXISTS product            CASCADE;
DROP TABLE IF EXISTS warehouse          CASCADE;
DROP TABLE IF EXISTS supplier           CASCADE;
