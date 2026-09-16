export type LogCategory = "integration" | "authentication" | "error" | "activity";

export const LOG_CATEGORY_TYPES: Record<LogCategory, string[]> = {
  integration: ["INTEGRATION", "API"],
  authentication: ["AUTHENTICATION"],
  error: ["ERROR"],
  activity: ["USER_ACTIVITY", "CHAT_ACTIVITY", "SYSTEM", "REPORT"],
};

export const LOG_CATEGORY_PERMISSIONS: Record<LogCategory, string> = {
  integration: "logs.integration.view",
  authentication: "logs.authentication.view",
  error: "logs.error.view",
  activity: "logs.activity.view",
};
