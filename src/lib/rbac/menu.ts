import type { CurrentSession } from "@/lib/auth/dal";
import { sessionHasPermission } from "@/lib/rbac/guards";

export type DashboardMenuItem = {
  label: string;
  href: string;
  permission: string;
};

const menuItems: DashboardMenuItem[] = [
  { label: "Dashboard", href: "/dashboard", permission: "dashboard.view" },
  { label: "Applications", href: "/dashboard/applications", permission: "applications.view" },
  { label: "Widget Authentication", href: "/dashboard/widget-auth", permission: "applications.view" },
  { label: "Integrations", href: "/dashboard/integrations", permission: "integrations.view" },
  { label: "Users & Access", href: "/dashboard/users", permission: "users.view" },
  { label: "Groups & Memberships", href: "/dashboard/groups", permission: "groups.view" },
  { label: "Content Moderation", href: "/dashboard/moderation", permission: "moderation.view" },
  { label: "Reports", href: "/dashboard/reports/chat-logs", permission: "reports.chat_logs.view" },
  { label: "Logs & Audit", href: "/dashboard/logs", permission: "logs.view" },
  { label: "Roles & Permissions", href: "/dashboard/roles", permission: "roles.view" },
];

export function getAllowedDashboardMenu(session: CurrentSession): DashboardMenuItem[] {
  return menuItems.filter((item) => sessionHasPermission(session, item.permission));
}
