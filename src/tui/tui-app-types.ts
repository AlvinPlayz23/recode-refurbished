/**
 * Shared TUI-specific types extracted from the main app module.
 */

import type {
  ApprovalMode,
  QuestionAnswer,
  QuestionToolDecision,
  QuestionToolRequest,
  ToolApprovalDecision,
  ToolApprovalRequest
} from "../tools/tool.ts";
import type { ThemeDefinition } from "./appearance/theme.ts";

/**
 * One selectable model-picker option.
 */
export interface ModelPickerOption {
  readonly providerId: string;
  readonly providerName: string;
  readonly modelId: string;
  readonly label: string;
  readonly active: boolean;
  readonly providerActive: boolean;
  readonly custom: boolean;
}

/**
 * One selectable theme row in the theme picker.
 */
export interface ThemePickerItem extends ThemeDefinition {
  readonly active: boolean;
}

/**
 * One selectable customize-row option.
 */
export interface CustomizeRowOption {
  readonly label: string;
  readonly value: string;
}

/**
 * One row in the customize overlay.
 */
export interface CustomizeRow {
  readonly id: "tool-marker" | "theme" | "todo-panel" | "bash-output";
  readonly label: string;
  readonly option: CustomizeRowOption;
  readonly description: string;
}

/**
 * One selectable approval-mode option.
 */
export interface ApprovalModePickerItem {
  readonly mode: ApprovalMode;
  readonly label: string;
  readonly description: string;
  readonly active: boolean;
}

/**
 * One selectable layout-picker option.
 */
export interface LayoutPickerItem {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly active: boolean;
}

/**
 * The currently active approval request shown in the UI.
 */
export interface ActiveApprovalRequest extends ToolApprovalRequest {
  readonly selectedIndex: number;
  readonly resolve: (decision: ToolApprovalDecision) => void;
}

/**
 * The currently active question request shown in the UI.
 */
export interface ActiveQuestionRequest extends QuestionToolRequest {
  readonly currentQuestionIndex: number;
  readonly selectedOptionIndex: number;
  readonly answers: Readonly<Record<string, QuestionAnswer>>;
  readonly resolve: (decision: QuestionToolDecision) => void;
}

/**
 * One transient toast notification.
 */
export interface ActiveToast {
  readonly message: string;
}
