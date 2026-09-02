export const APPLICATION_RETENTION_DEFINITIONS = [
  { dataType: "CHAT", category: "messages", label: "Chat Messages", retentionDays: null, keepForever: true },
  { dataType: "ATTACHMENT", category: "files", label: "Message Attachments", retentionDays: 30, keepForever: false },
  { dataType: "LOG", category: "integration", label: "Integration Logs", retentionDays: 90, keepForever: false },
  { dataType: "LOG", category: "api", label: "API Logs", retentionDays: 90, keepForever: false },
  { dataType: "LOG", category: "authentication", label: "Authentication Logs", retentionDays: 180, keepForever: false },
  { dataType: "LOG", category: "error", label: "Error Logs", retentionDays: 365, keepForever: false },
  { dataType: "LOG", category: "system", label: "System Logs", retentionDays: 180, keepForever: false },
  { dataType: "LOG", category: "user_activity", label: "User Activity Logs", retentionDays: 90, keepForever: false },
  { dataType: "LOG", category: "chat_activity", label: "Chat Activity Logs", retentionDays: 90, keepForever: false },
  { dataType: "LOG", category: "content_violation", label: "Content Violation Logs", retentionDays: 365, keepForever: false },
  { dataType: "LOG", category: "report", label: "Report Logs", retentionDays: 365, keepForever: false },
  { dataType: "LOG", category: "audit", label: "Audit Logs", retentionDays: null, keepForever: true },
] as const satisfies readonly {
  dataType: "LOG" | "CHAT" | "ATTACHMENT";
  category: string;
  label: string;
  retentionDays: number | null;
  keepForever: boolean;
}[];

export type ApplicationRetentionCategory = (typeof APPLICATION_RETENTION_DEFINITIONS)[number]["category"];

export function applicationRetentionKey(
  applicationId: string,
  dataType: "LOG" | "CHAT" | "ATTACHMENT",
  category: string,
) {
  return `APP:${applicationId}:${dataType.toLowerCase()}:${category}`;
}
