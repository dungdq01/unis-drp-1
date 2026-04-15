const BASE = '/api/v1/system-config';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConfigGroup = 'PLANNING_CYCLE' | 'PLUGIN_PARAMS' | 'FEATURE_TOGGLE' | 'BRAVO_ADAPTER' | 'MASKING';
export type ValueType   = 'STRING' | 'NUMBER' | 'BOOLEAN' | 'JSON';

export interface ConfigItem {
  key:         string;
  value:       string;
  type:        ValueType;
  isSensitive: boolean;
  description: string | null;
  updatedBy:   string | null;
  updatedAt:   string;
}

export interface ConfigGroupResponse {
  group:   ConfigGroup;
  configs: ConfigItem[];
}

export interface ToggleItem {
  key:         string;
  value:       string;
  description: string | null;
  updatedAt:   string;
}

export interface RoleItem {
  role:        string;
  scope:       string;
  permissions: string[];
  masking:     string;
}

export interface AuditLogItem {
  id:          string;
  configGroup: string;
  configKey:   string;
  oldValue:    string | null;
  newValue:    string;
  changedBy:   string;
  changedAt:   string;
  reason:      string | null;
}

export interface UpdateItem {
  group:   ConfigGroup;
  key:     string;
  value:   string;
  reason?: string;
}

// ─── API ──────────────────────────────────────────────────────────────────────

async function req<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
  return res.json();
}

export const fetchAllConfigs = (group?: ConfigGroup): Promise<ConfigGroupResponse[]> =>
  req(group ? `${BASE}?group=${group}` : BASE);

export const fetchConfigGroup = (group: ConfigGroup): Promise<ConfigGroupResponse> =>
  req(`${BASE}/${group}`);

export const updateConfigs = (updates: UpdateItem[], updatedBy: string): Promise<{ updated: number; auditIds: string[] }> =>
  req(BASE, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ updates, updatedBy }),
  });

export const fetchToggles = (): Promise<ToggleItem[]> =>
  req(`${BASE}/toggles`);

export const updateToggle = (key: string, value: string, updatedBy: string, reason?: string): Promise<{ updated: boolean; auditId: string }> =>
  req(`${BASE}/toggles/${key}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value, updatedBy, reason }),
  });

export const fetchRoles = (): Promise<{ note: string; roles: RoleItem[] }> =>
  req(`${BASE}/roles`);

export const fetchAuditLog = (page = 1, size = 20): Promise<{ data: AuditLogItem[]; total: number; page: number; size: number }> =>
  req(`${BASE}/audit?page=${page}&size=${size}`);
