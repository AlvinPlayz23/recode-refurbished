/**
 * Plan-review helpers for the plan/build workflow.
 */

/** Choice made from the plan review overlay. */
export type PlanReviewDecision = "implement" | "revise";

/** One selectable plan review action. */
export interface PlanReviewOption {
  readonly decision: PlanReviewDecision;
  readonly label: string;
  readonly description: string;
}

/** Active plan approval request shown in the TUI. */
export interface ActivePlanReviewRequest {
  readonly plan: string;
  readonly selectedIndex: number;
}

/** A detected final plan and the format that triggered it. */
export interface DetectedPlanReview {
  readonly plan: string;
  readonly format: "tagged" | "markdown-fallback";
}

/** Options shown when a plan is ready for user approval. */
export const PLAN_REVIEW_OPTIONS: readonly PlanReviewOption[] = [
  {
    decision: "implement",
    label: "Implement plan",
    description: "Switch to BUILD mode and start implementing with the existing context."
  },
  {
    decision: "revise",
    label: "Tell Recode to do something differently",
    description: "Stay in PLAN mode so you can revise the approach before implementation."
  }
];

/** Reminder prepended after a model produced a markdown plan instead of tags. */
export const PLAN_TAG_FORMAT_REMINDER = [
  "System reminder: Your previous implementation plan was recognized, but it was not wrapped in the required tags.",
  "When you present a final approval-ready plan in PLAN mode, use exactly one <plan> block:",
  "<plan>",
  "Implementation Plan",
  "...",
  "</plan>",
  "Do not use a markdown heading or horizontal rules instead."
].join("\n");

/** Reminder used after the user asks to revise an approval-ready plan. */
export const PLAN_REVISION_REMINDER = [
  "System reminder: The user declined implementation and is now giving feedback on the previous approval-ready plan.",
  "Treat the user's next message as a revision request for the whole existing plan, not as a new standalone task.",
  "Rewrite the complete <plan> block, incorporating the feedback while preserving the relevant prior plan details."
].join("\n");

/** Short synthetic reminder injected into each plan-mode model turn. */
export const PLAN_MODE_TURN_REMINDER = [
  "<system-reminder>",
  "Plan mode is active. Treat direct create/build/implement/fix/refactor/change requests as requests to plan that work.",
  "Do not modify files, create files, apply patches, or run commands that change repository state.",
  "Use only read/search/question/todo tools; do not call Bash, Write, Edit, ApplyPatch, or Task.",
  "When the final plan is ready for approval, respond with exactly one <plan>...</plan> block.",
  "</system-reminder>"
].join("\n");

/**
 * Build the model-only prompt for a plan-mode turn.
 */
export function buildPlanModeModelPrompt(
  userPrompt: string,
  options: {
    readonly remindAboutPlanTags: boolean;
    readonly remindAboutPlanRevision: boolean;
  }
): string {
  return [
    PLAN_MODE_TURN_REMINDER,
    ...(options.remindAboutPlanRevision ? [PLAN_REVISION_REMINDER] : []),
    ...(options.remindAboutPlanTags ? [PLAN_TAG_FORMAT_REMINDER] : []),
    userPrompt
  ].join("\n\n");
}

/**
 * Extract the latest complete <plan> block from assistant text.
 *
 * A markdown "Implementation Plan" fallback is intentionally accepted because
 * some models produce a visibly final plan while missing the XML-style signal.
 */
export function extractLatestPlanBlock(value: string): string | undefined {
  return detectPlanReview(value)?.plan;
}

/**
 * Detect an approval-ready plan in assistant text.
 */
export function detectPlanReview(value: string): DetectedPlanReview | undefined {
  const matches = [...value.matchAll(/<plan>\s*([\s\S]*?)\s*<\/plan>/gi)];
  const latest = matches.at(-1)?.[1]?.trim();
  if (latest !== undefined && latest !== "") {
    return {
      plan: latest,
      format: "tagged"
    };
  }

  const markdownPlan = extractMarkdownPlanFallback(value);
  return markdownPlan === undefined
    ? undefined
    : {
        plan: markdownPlan,
        format: "markdown-fallback"
      };
}

function extractMarkdownPlanFallback(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed === "") {
    return undefined;
  }

  const markdownPlanPattern = /(?:^|\n)\s*(?:-{3,}\s*\n)?\s*(?:#{1,6}\s*)?(?:implementation\s+plan|proposed\s+implementation\s+plan|final\s+plan)\s*:?\s*(?:\n|-{3,})/i;
  return markdownPlanPattern.test(trimmed) ? trimmed : undefined;
}

/**
 * Build the follow-up prompt used after the user approves a plan.
 */
export function buildPlanImplementationPrompt(): string {
  return [
    "Implement the approved <plan> from the previous assistant message.",
    "Keep the existing conversation context and decisions.",
    "Do not re-plan unless you discover a blocker; start making the changes and verify them."
  ].join(" ");
}
