import { z, type ZodType } from "zod";

const uuid = z.string().uuid();
const optionalUuid = uuid.nullish();

export const groupReferencePayloadSchema = z.object({ groupId: uuid }).strict();
export const groupMessagePayloadSchema = z.object({
  groupId: uuid,
  content: z.string().min(1).max(4_100),
  replyMessageId: optionalUuid,
  clientMessageId: z.string().trim().min(1).max(200).nullish(),
}).strict();
export const groupReadPayloadSchema = z.object({
  groupId: uuid,
  upToMessageId: optionalUuid,
}).strict();

export const privateTargetPayloadSchema = z.object({ targetUserIdentityId: uuid }).strict();
export const privateRoomPayloadSchema = z.object({ roomId: uuid }).strict();
export const privateMessagePayloadSchema = z.object({
  roomId: uuid,
  content: z.string().min(1).max(4_100),
  replyMessageId: optionalUuid,
  clientMessageId: z.string().trim().min(1).max(200).nullish(),
}).strict();
export const privateReadPayloadSchema = z.object({
  roomId: uuid,
  upToMessageId: optionalUuid,
}).strict();

export class RealtimePayloadError extends Error {
  readonly code = "REALTIME_PAYLOAD_INVALID";

  constructor(public readonly details?: unknown) {
    super("Realtime request payload is invalid");
    this.name = "RealtimePayloadError";
  }
}

export function parseRealtimePayload<T>(schema: ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new RealtimePayloadError(parsed.error.flatten());
  }
  return parsed.data;
}
