CREATE TABLE IF NOT EXISTS system_config (
  id            BIGSERIAL     PRIMARY KEY,
  config_group  VARCHAR(50)   NOT NULL,
  config_key    VARCHAR(100)  NOT NULL,
  config_value  TEXT          NOT NULL,
  value_type    VARCHAR(20)   NOT NULL DEFAULT 'STRING',
  description   TEXT          NULL,
  is_sensitive  BOOLEAN       NOT NULL DEFAULT FALSE,
  updated_by    VARCHAR(100)  NULL,
  updated_at    TIMESTAMP     NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMP     NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_system_config_group_key UNIQUE (config_group, config_key)
);

CREATE INDEX IF NOT EXISTS idx_system_config_group ON system_config (config_group);

CREATE TABLE IF NOT EXISTS config_audit_log (
  id            BIGSERIAL     PRIMARY KEY,
  config_group  VARCHAR(50)   NOT NULL,
  config_key    VARCHAR(100)  NOT NULL,
  old_value     TEXT          NULL,
  new_value     TEXT          NOT NULL,
  changed_by    VARCHAR(100)  NOT NULL,
  changed_at    TIMESTAMP     NOT NULL DEFAULT NOW(),
  reason        TEXT          NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_log_key        ON config_audit_log (config_group, config_key);
CREATE INDEX IF NOT EXISTS idx_audit_log_changed_at ON config_audit_log (changed_at DESC);
