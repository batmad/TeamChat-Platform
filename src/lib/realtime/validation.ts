import { z, type ZodType } from "zod";

const uuid = z.string().uuid();
const optionalUuid = uuid.nullish();
const attachmentIds = z.array(uuid).max(20).optional().default([]);
const requireMessageBody = <T extends { content: string; attachmentIds?: string[] }>(
  value: T,
  ctx: z.RefinementCtx,
) => {
  if (!value.content.trim() && !(value.attachmentIds?.length ?? 0)) {
    ctx.addIssue({
      code: "custom",
      path: ["content"],
      message: "Message must contain text or at least one attachment",
    });
  }
};
export const groupReferencePayloadSchema = z.object({ groupId: uuid }).strict();
export const groupMessagePayloadSchema = z.object({
  groupId: uuid,
  content: z.string().max(4_100),
  attachmentIds,
  replyMessageId: optionalUuid,
  clientMessageId: z.string().trim().min(1).max(200).nullish(),
}).strict().superRefine(requireMessageBody);
export const groupReadPayloadSchema = z.object({
  groupId: uuid,
  upToMessageId: optionalUuid,
}).strict();

export const privateTargetPayloadSchema = z.object({ targetUserIdentityId: uuid }).strict();
export const privateRoomPayloadSchema = z.object({ roomId: uuid }).strict();
export const privateMessagePayloadSchema = z.object({
  roomId: uuid,
  content: z.string().max(4_100),
  attachmentIds,
  replyMessageId: optionalUuid,
  clientMessageId: z.string().trim().min(1).max(200).nullish(),
}).strict().superRefine(requireMessageBody);
export const attachmentDeletePayloadSchema = z.object({
  attachmentId: uuid,
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
