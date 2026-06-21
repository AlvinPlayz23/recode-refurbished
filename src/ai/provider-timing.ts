/**
 * Optional provider timing diagnostics.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import type { AiModel } from "./types.ts";
import type { JsonObject } from "../shared/json-value.ts";

/**
 * One timing span for a provider request.
 */
export interface ProviderTimingSpan {
  mark(event: string, fields?: JsonObject): void;
  markOnce(event: string, fields?: JsonObject): void;
}

/**
 * Create an optional timing span. Disabled unless RECODE_AI_TIMING is set.
 */
export function createProviderTimingSpan(options: {
  readonly model: AiModel;
  readonly operation: string;
  readonly requestAffinityKey?: string;
}): ProviderTimingSpan {
  const sink = resolveTimingSink();
  const start = performance.now();
  const seenEvents = new Set<string>();

  const write = (event: string, fields: JsonObject | undefined) => {
    if (sink.kind === "disabled") {
      return;
    }

    const line = JSON.stringify({
      time: new Date().toISOString(),
      event,
      elapsedMs: Math.round((performance.now() - start) * 100) / 100,
      providerId: options.model.providerId,
      provider: options.model.provider,
      model: options.model.modelId,
      operation: options.operation,
      ...(options.requestAffinityKey === undefined ? {} : { requestAffinityKey: options.requestAffinityKey }),
      ...(fields ?? {})
    });

    writeTimingLine(sink, line);
  };

  return {
    mark(event, fields) {
      write(event, fields);
    },
    markOnce(event, fields) {
      if (seenEvents.has(event)) {
        return;
      }

      seenEvents.add(event);
      write(event, fields);
    }
  };
}

type TimingSink =
  | { readonly kind: "disabled" }
  | { readonly kind: "stderr" }
  | { readonly kind: "file"; readonly path: string };

function resolveTimingSink(): TimingSink {
  const value = Bun.env.RECODE_AI_TIMING?.trim().toLowerCase();
  if (value === undefined || value === "" || value === "0" || value === "false" || value === "off") {
    return { kind: "disabled" };
  }

  if (value === "stderr") {
    return { kind: "stderr" };
  }

  return {
    kind: "file",
    path: resolve(Bun.env.RECODE_AI_TIMING_PATH?.trim() || resolve(homedir(), ".recode", "ai-timing.jsonl"))
  };
}

function writeTimingLine(sink: Exclude<TimingSink, { readonly kind: "disabled" }>, line: string): void {
  if (sink.kind === "stderr") {
    Bun.stderr.write(`${line}\n`);
    return;
  }

  mkdirSync(dirname(sink.path), { recursive: true });
  appendFileSync(sink.path, `${line}\n`, "utf8");
}
