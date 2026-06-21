/**
 * Shared step-stat metadata for one assistant turn.
 */

/**
 * Token usage breakdown for one model step. Input and output are parent totals;
 * reasoning/cache fields are breakdowns and must not be added to those totals.
 */
export interface StepTokenUsage {
  readonly input: number;
  readonly output: number;
  readonly reasoning: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
}

/**
 * Structured completion metadata for one assistant step.
 */
export interface StepStats {
  readonly finishReason: string;
  readonly durationMs: number;
  readonly toolCallCount: number;
  readonly costUsd?: number;
  readonly tokenUsage?: StepTokenUsage;
}

/**
 * Return a normalized zeroed token-usage object.
 */
export function createEmptyStepTokenUsage(): StepTokenUsage {
  return {
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0
  };
}

/**
 * Add two token-usage objects together.
 */
export function addStepTokenUsage(
  left: StepTokenUsage | undefined,
  right: StepTokenUsage | undefined
): StepTokenUsage | undefined {
  if (left === undefined && right === undefined) {
    return undefined;
  }

  const base = left ?? createEmptyStepTokenUsage();
  const next = right ?? createEmptyStepTokenUsage();

  return {
    input: base.input + next.input,
    output: base.output + next.output,
    reasoning: base.reasoning + next.reasoning,
    cacheRead: base.cacheRead + next.cacheRead,
    cacheWrite: base.cacheWrite + next.cacheWrite
  };
}
