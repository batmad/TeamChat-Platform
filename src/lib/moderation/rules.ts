export type ModerationRuleScope = "GLOBAL" | "APPLICATION" | "GROUP";
export type ModerationMatchMode = "EXACT_WORD" | "CONTAINS";

export type ModerationRuleCandidate = {
  id: string;
  scope: ModerationRuleScope;
  pattern: string;
  normalizedPattern: string;
  matchMode: ModerationMatchMode;
};

export type ModerationMatch = ModerationRuleCandidate & {
  matchedText: string;
};

export function normalizeModerationText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
}

export function normalizeForbiddenPattern(value: string): string {
  return normalizeModerationText(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function exactWordMatch(content: string, pattern: string): string | null {
  if (!pattern) return null;
  const escaped = escapeRegExp(pattern);
  const expression = new RegExp(`(?:^|[^\\p{L}\\p{N}_])(${escaped})(?=$|[^\\p{L}\\p{N}_])`, "u");
  return expression.exec(content)?.[1] ?? null;
}

export function matchForbiddenRule(content: string, rule: ModerationRuleCandidate): string | null {
  const normalizedContent = normalizeModerationText(content);
  if (!normalizedContent || !rule.normalizedPattern) return null;
  if (rule.matchMode === "CONTAINS") {
    return normalizedContent.includes(rule.normalizedPattern) ? rule.normalizedPattern : null;
  }
  return exactWordMatch(normalizedContent, rule.normalizedPattern);
}

const scopePriority: Record<ModerationRuleScope, number> = {
  GROUP: 3,
  APPLICATION: 2,
  GLOBAL: 1,
};

export function findForbiddenMatches(content: string, rules: readonly ModerationRuleCandidate[]): ModerationMatch[] {
  return rules
    .map((rule) => {
      const matchedText = matchForbiddenRule(content, rule);
      return matchedText ? { ...rule, matchedText } : null;
    })
    .filter((match): match is ModerationMatch => Boolean(match))
    .sort((first, second) => {
      const scopeDifference = scopePriority[second.scope] - scopePriority[first.scope];
      if (scopeDifference !== 0) return scopeDifference;
      if (first.matchMode !== second.matchMode) return first.matchMode === "EXACT_WORD" ? -1 : 1;
      return second.normalizedPattern.length - first.normalizedPattern.length;
    });
}

export function validateForbiddenWordScope(input: {
  scope: ModerationRuleScope;
  applicationId?: string | null;
  groupId?: string | null;
}): boolean {
  if (input.scope === "GLOBAL") return !input.applicationId && !input.groupId;
  if (input.scope === "APPLICATION") return Boolean(input.applicationId) && !input.groupId;
  return Boolean(input.applicationId) && Boolean(input.groupId);
}
