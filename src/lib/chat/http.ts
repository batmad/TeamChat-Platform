import { AppError } from "@/lib/api/app-error";
import { GroupChatAccessError } from "@/lib/chat/group-access";
import { PrivateChatAccessError } from "@/lib/chat/private-access";

export function toChatAppError(error: unknown): never {
  if (error instanceof GroupChatAccessError || error instanceof PrivateChatAccessError) {
    throw new AppError(error.statusCode, error.code, error.message);
  }
  throw error;
}
