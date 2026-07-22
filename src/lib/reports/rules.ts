export type ScopeAssignmentChoice<T> = {
  assignment: T | null;
  source: "USER" | "ROLE" | "DEFAULT";
};

export function chooseReportScopeAssignment<T>(
  userAssignment: T | null,
  roleAssignment: T | null,
): ScopeAssignmentChoice<T> {
  if (userAssignment) return { assignment: userAssignment, source: "USER" };
  if (roleAssignment) return { assignment: roleAssignment, source: "ROLE" };
  return { assignment: null, source: "DEFAULT" };
}

export function reportScopeAllowsGroup(input: {
  unrestricted: boolean;
  allowedGroupIds: string[];
  groupId: string;
}) {
  return input.unrestricted || input.allowedGroupIds.includes(input.groupId);
}

export function canIncludePrivateMessageWithoutHistoricalGroupContext(unrestricted: boolean) {
  return unrestricted;
}
