import { z } from "zod";

export const standardUserSchema = z.object({
  username: z.string().trim().min(1).max(255),
  name: z.string().trim().min(1).max(255),
  role: z.string().trim().min(1).max(120),
  group: z.string().trim().min(1).max(160),
});

export type StandardUser = z.infer<typeof standardUserSchema>;

export type StandardUserReadiness = {
  readyForChat: boolean;
  user: StandardUser | null;
  issues: StandardUserIssue[];
};

export type StandardUserIssue =
  | "USERNAME_MISSING"
  | "NAME_MISSING"
  | "ROLE_MISSING"
  | "GROUP_MISSING";

export function createStandardUser(input: StandardUser): StandardUser {
  return standardUserSchema.parse(input);
}

export function buildStandardUserReadiness(input: {
  username?: string | null;
  name?: string | null;
  role?: string | null;
  group?: string | null;
}): StandardUserReadiness {
  const issues: StandardUserIssue[] = [];

  if (!input.username?.trim()) issues.push("USERNAME_MISSING");
  if (!input.name?.trim()) issues.push("NAME_MISSING");
  if (!input.role?.trim()) issues.push("ROLE_MISSING");
  if (!input.group?.trim()) issues.push("GROUP_MISSING");

  if (issues.length) {
    return { readyForChat: false, user: null, issues };
  }

  return {
    readyForChat: true,
    user: createStandardUser({
      username: input.username!,
      name: input.name!,
      role: input.role!,
      group: input.group!,
    }),
    issues: [],
  };
}
