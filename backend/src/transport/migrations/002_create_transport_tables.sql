BEGIN;

-- ── vehicle_type ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vehicle_type (
    id               BIGSERIAL    PRIMARY KEY,
    code             VARCHAR(20)  NOT NULL UNIQUE,
    label            VARCHAR(50)  NOT NULL,
    capacity_kg      DECIMAL(10,2) NOT NULL,
    capacity_pallets INT          NOT NULL DEFAULT 0,
    cost_multiplier  DECIMAL(5,3) NOT NULL DEFAULT 1.0,
    is_active        BOOLEAN      NOT NULL DEFAULT true,
    created_at       TIMESTAMP    NOT NULL DEFAULT NOW()
);

INSERT INTO vehicle_type (code, label, capacity_kg, capacity_pallets, cost_multiplier)
VALUES
  ('FLATBED',     'Xe tải phẳng 25T', 25000, 20, 1.0),
  ('CRANE_TRUCK', 'Xe cẩu 15T',       15000, 12, 1.3)
ON CONFLICT (code) DO NOTHING;

-- ── carrier ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS carrier (
    id                   BIGSERIAL    PRIMARY KEY,
    carrier_code         VARCHAR(20)  NOT NULL UNIQUE,
    carrier_name         VARCHAR(100) NOT NULL,
    contact_phone        VARCHAR(20),
    historical_otd_pct   DECIMAL(5,4) NOT NULL DEFAULT 0.9,
    supported_vehicles   VARCHAR(100) NOT NULL DEFAULT 'FLATBED,CRANE_TRUCK',
    is_active            BOOLEAN      NOT NULL DEFAULT true,
    note                 TEXT,
    created_at           TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_carrier_active ON carrier(is_active);

-- ── transport_lane ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transport_lane (
    id                   BIGSERIAL    PRIMARY KEY,
    source_location_code VARCHAR(20)  NOT NULL,
    dest_location_code   VARCHAR(20)  NOT NULL,
    distance_km          DECIMAL(8,2) NOT NULL DEFAULT 0,
    lead_time_days       INT          NOT NULL DEFAULT 1,
    rate_vnd_per_km      DECIMAL(12,2) NOT NULL DEFAULT 15000,
    carrier_codes        VARCHAR(200) NOT NULL DEFAULT '',
    is_active            BOOLEAN      NOT NULL DEFAULT true,
    note                 TEXT,
    created_at           TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMP    NOT NULL DEFAULT NOW(),
    UNIQUE(source_location_code, dest_location_code)
);

CREATE INDEX IF NOT EXISTS idx_lane_source ON transport_lane(source_location_code);
CREATE INDEX IF NOT EXISTS idx_lane_dest   ON transport_lane(dest_location_code);

-- ── transport_plan ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transport_plan (
    id                  BIGSERIAL    PRIMARY KEY,
    allocation_run_id   BIGINT       NOT NULL UNIQUE REFERENCES allocation_run(id),
    status              VARCHAR(20)  NOT NULL DEFAULT 'DRAFT',
    total_trips         INT          NOT NULL DEFAULT 0,
    total_weight_kg     DECIMAL(15,2) NOT NULL DEFAULT 0,
    total_cost_vnd      DECIMAL(18,2) NOT NULL DEFAULT 0,
    created_by          VARCHAR(100),
    confirmed_by        VARCHAR(100),
    confirmed_at        TIMESTAMP,
    created_at          TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transport_plan_run ON transport_plan(allocation_run_id);
CREATE INDEX IF NOT EXISTS idx_transport_plan_status ON transport_plan(status);

-- ── transport_trip ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transport_trip (
    id                    BIGSERIAL    PRIMARY KEY,
    transport_plan_id     BIGINT       NOT NULL REFERENCES transport_plan(id),
    source_location_code  VARCHAR(20)  NOT NULL,
    dest_location_code    VARCHAR(20)  NOT NULL,
    vehicle_type_code     VARCHAR(20)  NOT NULL,
    carrier_code          VARCHAR(20),
    total_weight_kg       DECIMAL(10,2) NOT NULL DEFAULT 0,
    total_pallets         INT          NOT NULL DEFAULT 0,
    estimated_cost_vnd    DECIMAL(18,2) NOT NULL DEFAULT 0,
    departure_date        DATE,
    eta_date              DATE,
    lead_time_days        INT          NOT NULL DEFAULT 1,
    status                VARCHAR(20)  NOT NULL DEFAULT 'PLANNED',
    exception_note        TEXT,
    created_at            TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trip_plan   ON transport_trip(transport_plan_id);
CREATE INDEX IF NOT EXISTS idx_trip_route  ON transport_trip(source_location_code, dest_location_code);
CREATE INDEX IF NOT EXISTS idx_trip_status ON transport_trip(status);

-- ── transport_trip_line ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transport_trip_line (
    id                    BIGSERIAL    PRIMARY KEY,
    transport_trip_id     BIGINT       NOT NULL REFERENCES transport_trip(id),
    allocation_result_id  BIGINT       NOT NULL REFERENCES allocation_result(id),
    item_code             VARCHAR(50)  NOT NULL,
    allocated_qty         DECIMAL(15,2) NOT NULL DEFAULT 0,
    weight_kg             DECIMAL(10,2) NOT NULL DEFAULT 0,
    created_at            TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trip_line_trip ON transport_trip_line(transport_trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_line_alloc ON transport_trip_line(allocation_result_id);

COMMIT;
