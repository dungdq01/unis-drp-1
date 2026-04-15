import { ModuleShell } from "@/components/module-shell";

export default function ConfigPage() {
  return (
    <ModuleShell
      name="Policy Platform"
      subtitle="27 policy types · Feature Toggles · Tenant Config"
      description="Quản lý cấu hình toàn hệ thống UNIS: PlanningCycle (cutoff=23:00 ICT, horizon=12 weeks), UNIS Plugin params (CSL targets, LCNB mode, ABC weights), RBAC roles (SC_MANAGER, CN_WH, FORECAST_EDITOR, DATA_MANAGER), Bravo ERP adapter config, Mobile Masking policy cho CN_WH role."
      docRef="SCP-UNIS-CFG"
      version="v1.0"
      status="draft"
      owner="R-BA · BE · TechLead"
      metrics={[
        { label: "Policy Types", value: "27",    status: "ok"      },
        { label: "UNIS Plugins", value: "4",     status: "ok"      },
        { label: "RBAC Roles",   value: "4",     status: "ok"      },
        { label: "Tenant",       value: "UNIS",  status: "ok"      },
      ]}
    />
  );
}
