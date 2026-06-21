/**
 * ACP wire types used by the Recode broker.
 */

import type { JsonRpcObject } from "./json-rpc.ts";

/** ACP content block subset supported by Recode. */
export type AcpContentBlock =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "resource"; readonly resource: AcpEmbeddedResource }
  | { readonly type: "resource_link"; readonly uri: string; readonly name: string; readonly title?: string };

/** Embedded ACP resource. */
export type AcpEmbeddedResource =
  | { readonly uri: string; readonly text: string; readonly mimeType?: string }
  | { readonly uri: string; readonly blob: string; readonly mimeType?: string };

/** ACP session update notification. */
export interface AcpSessionNotification {
  readonly sessionId: string;
  readonly update: AcpSessionUpdate;
}

/** ACP session update subset emitted by the broker. */
export type AcpSessionUpdate =
  | {
      readonly sessionUpdate: "user_message_chunk" | "agent_message_chunk";
      readonly content: { readonly type: "text"; readonly text: string };
      readonly messageId?: string;
    }
  | {
      readonly sessionUpdate: "user_message";
      readonly messageId: string;
      readonly content: readonly AcpContentBlock[];
    }
  | {
      readonly sessionUpdate: "state_change";
      readonly state: "running" | "idle" | "requires_action";
      readonly stopReason?: "end_turn" | "max_tokens" | "max_turn_requests" | "refusal" | "cancelled";
      readonly error?: string;
    }
  | {
      readonly sessionUpdate: "tool_call";
      readonly toolCallId: string;
      readonly title: string;
      readonly kind: AcpToolKind;
      readonly status: AcpToolStatus;
      readonly rawInput?: JsonRpcObject;
      readonly locations?: readonly AcpToolLocation[];
    }
  | {
      readonly sessionUpdate: "tool_call_update";
      readonly toolCallId: string;
      readonly status?: AcpToolStatus;
      readonly title?: string;
      readonly content?: readonly AcpToolCallContent[];
      readonly rawOutput?: unknown;
    }
  | {
      readonly sessionUpdate: "plan";
      readonly entries: readonly AcpPlanEntry[];
    }
  | {
      readonly sessionUpdate: "config_option_update";
      readonly configOptions: readonly AcpSessionConfigOption[];
    }
  | {
      readonly sessionUpdate: "current_mode_update";
      readonly currentModeId: string;
    }
  | {
      readonly sessionUpdate: "session_info_update";
      readonly title?: string | null;
      readonly updatedAt?: string | null;
    };

/** ACP tool category. */
export type AcpToolKind = "read" | "edit" | "delete" | "move" | "search" | "execute" | "think" | "fetch" | "other";

/** ACP tool status. */
export type AcpToolStatus = "pending" | "in_progress" | "completed" | "failed";

/** ACP file location. */
export interface AcpToolLocation {
  readonly path: string;
  readonly line?: number;
}

/** ACP tool content subset. */
export type AcpToolCallContent =
  | {
      readonly type: "content";
      readonly content: { readonly type: "text"; readonly text: string };
    }
  | {
      readonly type: "diff";
      readonly path: string;
      readonly oldText?: string | null;
      readonly newText: string;
    };

/** ACP plan entry. */
export interface AcpPlanEntry {
  readonly content: string;
  readonly priority: "high" | "medium" | "low";
  readonly status: "pending" | "in_progress" | "completed";
}

/** ACP session config option. */
export interface AcpSessionConfigOption {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly category?: "mode" | "model";
  readonly type: "select";
  readonly currentValue: string;
  readonly options: readonly AcpSessionConfigOptionValue[];
}

/** ACP session config option value. */
export interface AcpSessionConfigOptionValue {
  readonly value: string;
  readonly name: string;
  readonly description?: string;
}
