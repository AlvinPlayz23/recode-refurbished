/**
 * Appearance, approval, status, and layout helper logic for the TUI.
 */

import {
  loadRecodeConfigFile,
  saveRecodeConfigFile,
  selectConfiguredApprovalAllowlist,
  selectConfiguredApprovalMode,
  selectConfiguredLayoutMode,
  selectConfiguredRetainBashToolOutput,
  selectConfiguredTheme,
  selectConfiguredTodoPanelEnabled,
  selectConfiguredToolMarker
} from "../../config/recode-config.ts";
import type { ApprovalMode, ToolApprovalScope } from "../../tools/tool.ts";
import {
  getAvailableThemes,
  getAvailableToolMarkers,
  getThemeDefinition,
  getToolMarkerDefinition,
  type LayoutMode,
  type ThemeColors,
  type ThemeName,
  type ToolMarkerName
} from "./theme.ts";
import { getSpinnerPhaseGlyph, getSpinnerSegments, type SpinnerPhase } from "./spinner.ts";
import { getSpinnerPhaseLabel } from "../composer/composer.ts";
import type {
  ApprovalModePickerItem,
  CustomizeRow,
  LayoutPickerItem,
  ThemePickerItem
} from "../tui-app-types.ts";
import { appendErrorEntry, appendStatusEntry, type UiEntrySink } from "../tui-helper-output.ts";

interface MarqueeSegment {
  readonly text: string;
  readonly color: string;
}

/**
 * Build filtered theme picker rows.
 */
export function buildThemePickerItems(activeThemeName: ThemeName, query: string): readonly ThemePickerItem[] {
  const normalizedQuery = query.trim().toLowerCase();

  return getAvailableThemes()
    .filter((theme) => {
      if (normalizedQuery === "") {
        return true;
      }

      const haystack = `${theme.label} ${theme.name} ${theme.description}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    })
    .map((theme) => ({
      ...theme,
      active: theme.name === activeThemeName
    }));
}

/**
 * Open the theme picker.
 */
export function openThemePicker(
  setOpen: (value: boolean) => void,
  setQuery: (value: string) => void,
  setSelectedIndex: (value: number) => void,
  setWindowStart: (value: number) => void,
  activeThemeName: ThemeName
): void {
  const activeIndex = getAvailableThemes().findIndex((theme) => theme.name === activeThemeName);
  setOpen(true);
  setQuery("");
  setSelectedIndex(activeIndex === -1 ? 0 : activeIndex);
  setWindowStart(0);
}

/**
 * Close the theme picker.
 */
export function closeThemePicker(
  input: { focus(): void } | undefined,
  setOpen: (value: boolean) => void,
  setQuery: (value: string) => void,
  setSelectedIndex: (value: number) => void,
  setWindowStart: (value: number) => void
): void {
  setOpen(false);
  setQuery("");
  setSelectedIndex(0);
  setWindowStart(0);
  input?.focus();
}

export interface SubmitThemePickerSelectionOptions extends UiEntrySink {
  readonly configPath: string;
  readonly selectedIndex: number;
  readonly items: readonly ThemePickerItem[];
  readonly setThemeName: (value: ThemeName) => void;
  readonly close: () => void;
}

/**
 * Select the highlighted theme picker item.
 */
export async function submitSelectedThemePickerItem(options: SubmitThemePickerSelectionOptions): Promise<void> {
  const selectedItem = options.items[options.selectedIndex];
  if (selectedItem === undefined) {
    return;
  }

  try {
    persistSelectedTheme(options.configPath, selectedItem.name);
    options.setThemeName(selectedItem.name);
    appendStatusEntry(options, `Selected theme ${selectedItem.label}`);
    options.close();
  } catch (error) {
    appendErrorEntry(options, error);
  }
}

/**
 * Build approval-mode picker rows.
 */
export function buildApprovalModePickerItems(activeMode: ApprovalMode): readonly ApprovalModePickerItem[] {
  return [
    {
      mode: "approval",
      label: "Approval",
      description: "Local read tools run directly. Edit, Bash, and web tools ask first.",
      active: activeMode === "approval"
    },
    {
      mode: "auto-edits",
      label: "Auto-Edits",
      description: "Local read and edit tools run directly. Bash and web tools ask first.",
      active: activeMode === "auto-edits"
    },
    {
      mode: "yolo",
      label: "YOLO",
      description: "Run local, Bash, and web tools without asking.",
      active: activeMode === "yolo"
    }
  ];
}

/**
 * Open the approval-mode picker.
 */
export function openApprovalModePicker(
  setOpen: (value: boolean) => void,
  setSelectedIndex: (value: number) => void,
  setWindowStart: (value: number) => void,
  currentMode: ApprovalMode
): void {
  const items = buildApprovalModePickerItems(currentMode);
  const activeIndex = items.findIndex((item) => item.mode === currentMode);
  setOpen(true);
  setSelectedIndex(activeIndex === -1 ? 0 : activeIndex);
  setWindowStart(0);
}

/**
 * Close the approval-mode picker.
 */
export function closeApprovalModePicker(
  input: { focus(): void } | undefined,
  setOpen: (value: boolean) => void,
  setSelectedIndex: (value: number) => void,
  setWindowStart: (value: number) => void
): void {
  setOpen(false);
  setSelectedIndex(0);
  setWindowStart(0);
  input?.focus();
}

export interface SubmitApprovalModePickerSelectionOptions extends UiEntrySink {
  readonly configPath: string;
  readonly selectedIndex: number;
  readonly items: readonly ApprovalModePickerItem[];
  readonly approvalAllowlist: readonly ToolApprovalScope[];
  readonly updateApprovalSettings: (
    approvalMode: ApprovalMode,
    approvalAllowlist: readonly ToolApprovalScope[]
  ) => void;
  readonly close: () => void;
}

/**
 * Select the highlighted approval-mode row.
 */
export function submitSelectedApprovalModePickerItem(options: SubmitApprovalModePickerSelectionOptions): void {
  const selectedItem = options.items[options.selectedIndex];
  if (selectedItem === undefined) {
    return;
  }

  try {
    persistSelectedApprovalMode(options.configPath, selectedItem.mode);
    options.updateApprovalSettings(selectedItem.mode, options.approvalAllowlist);
    appendStatusEntry(options, `Selected approval mode ${selectedItem.label}`);
    options.close();
  } catch (error) {
    appendErrorEntry(options, error);
  }
}

/**
 * Persist approval allowlist settings.
 */
export function persistSelectedApprovalAllowlist(
  configPath: string,
  approvalAllowlist: readonly ToolApprovalScope[]
): void {
  const config = loadRecodeConfigFile(configPath);
  const nextConfig = selectConfiguredApprovalAllowlist(config, approvalAllowlist);
  saveRecodeConfigFile(configPath, nextConfig);
}

/**
 * Build customize picker rows.
 */
export function buildCustomizeRows(
  activeThemeName: ThemeName,
  activeToolMarkerName: ToolMarkerName,
  todoPanelEnabled: boolean,
  retainBashToolOutput: boolean
): readonly CustomizeRow[] {
  const toolMarker = getToolMarkerDefinition(activeToolMarkerName);
  const theme = getThemeDefinition(activeThemeName);

  return [
    {
      id: "tool-marker",
      label: "Tool Marker",
      option: {
        label: toolMarker.label,
        value: toolMarker.symbol
      },
      description: "Controls the marker shown before tool activity lines."
    },
    {
      id: "todo-panel",
      label: "Todos",
      option: {
        label: todoPanelEnabled ? "Enabled" : "Disabled",
        value: ""
      },
      description: "Shows the live TodoWrite panel above the composer."
    },
    {
      id: "bash-output",
      label: "Bash Output",
      option: {
        label: retainBashToolOutput ? "Retained" : "Freed",
        value: ""
      },
      description: "Keep Bash output previews in TUI memory, or free them after the tool call row is shown."
    },
    {
      id: "theme",
      label: "Theme",
      option: {
        label: theme.label,
        value: ""
      },
      description: "Switches the active color theme immediately."
    }
  ];
}

/**
 * Open the customize picker.
 */
export function openCustomizePicker(
  setOpen: (value: boolean) => void,
  setSelectedRow: (value: number) => void
): void {
  setOpen(true);
  setSelectedRow(0);
}

/**
 * Close the customize picker.
 */
export function closeCustomizePicker(
  input: { focus(): void } | undefined,
  setOpen: (value: boolean) => void,
  setSelectedRow: (value: number) => void
): void {
  setOpen(false);
  setSelectedRow(0);
  input?.focus();
}

export interface CycleCustomizeSettingOptions {
  readonly direction: -1 | 1;
  readonly rowIndex: number;
  readonly configPath: string;
  readonly themeName: () => ThemeName;
  readonly setThemeName: (value: ThemeName) => void;
  readonly toolMarkerName: () => ToolMarkerName;
  readonly setToolMarkerName: (value: ToolMarkerName) => void;
  readonly todoPanelEnabled: () => boolean;
  readonly setTodoPanelEnabled: (value: boolean) => void;
  readonly setTodoDropupOpen: (value: boolean) => void;
  readonly retainBashToolOutput: () => boolean;
  readonly setRetainBashToolOutput: (value: boolean) => void;
  readonly pruneBashToolOutput: () => void;
}

/**
 * Cycle the selected customize setting.
 */
export function cycleCustomizeSetting(options: CycleCustomizeSettingOptions): void {
  const rowIds = ["tool-marker", "todo-panel", "bash-output", "theme"] as const;
  const rowId = rowIds[(options.rowIndex % rowIds.length + rowIds.length) % rowIds.length] ?? "tool-marker";

  if (rowId === "tool-marker") {
    const markers = getAvailableToolMarkers();
    const currentIndex = markers.findIndex((marker) => marker.name === options.toolMarkerName());
    const nextIndex = (Math.max(0, currentIndex) + options.direction + markers.length) % markers.length;
    const nextMarker = markers[nextIndex];
    if (nextMarker === undefined) {
      return;
    }
    options.setToolMarkerName(nextMarker.name);
    persistSelectedToolMarker(options.configPath, nextMarker.name);
    return;
  }

  if (rowId === "todo-panel") {
    const nextEnabled = !options.todoPanelEnabled();
    options.setTodoPanelEnabled(nextEnabled);
    if (!nextEnabled) {
      options.setTodoDropupOpen(false);
    }
    persistTodoPanelEnabled(options.configPath, nextEnabled);
    return;
  }

  if (rowId === "bash-output") {
    const nextEnabled = !options.retainBashToolOutput();
    options.setRetainBashToolOutput(nextEnabled);
    if (!nextEnabled) {
      options.pruneBashToolOutput();
    }
    persistRetainBashToolOutput(options.configPath, nextEnabled);
    return;
  }

  const themes = getAvailableThemes();
  const currentIndex = themes.findIndex((theme) => theme.name === options.themeName());
  const nextIndex = (Math.max(0, currentIndex) + options.direction + themes.length) % themes.length;
  const nextTheme = themes[nextIndex];
  if (nextTheme === undefined) {
    return;
  }
  options.setThemeName(nextTheme.name);
  persistSelectedTheme(options.configPath, nextTheme.name);
}

/**
 * Build the status marquee segments.
 */
export function buildStatusMarquee(
  themeName: ThemeName,
  tick: number,
  theme: ThemeColors,
  phase: SpinnerPhase
): readonly MarqueeSegment[] {
  return [
    getSpinnerPhaseGlyph(phase, theme),
    { text: " ", color: theme.divider },
    ...getSpinnerSegments(themeName, tick, theme),
    { text: " ", color: theme.divider },
    { text: getSpinnerPhaseLabel(phase), color: theme.hintText }
  ];
}

/**
 * Build layout picker rows.
 */
export function buildLayoutPickerItems(currentLayout: LayoutMode, toolsCollapsed: boolean): readonly LayoutPickerItem[] {
  return [
    {
      id: "compact",
      label: "Compact",
      description: "Tighter spacing between messages for power users.",
      active: currentLayout === "compact"
    },
    {
      id: "comfortable",
      label: "Comfortable",
      description: "Airy spacing for easier readability.",
      active: currentLayout === "comfortable"
    },
    {
      id: "collapse-tools",
      label: toolsCollapsed ? "Expand Tool Output" : "Collapse Tool Output",
      description: toolsCollapsed
        ? "Show each tool call individually in the transcript."
        : "Group consecutive tool calls into a compact summary.",
      active: false
    }
  ];
}

/**
 * Open the layout picker.
 */
export function openLayoutPicker(
  setOpen: (value: boolean) => void,
  setSelectedIndex: (value: number) => void,
  setWindowStart: (value: number) => void,
  currentLayout: LayoutMode
): void {
  setOpen(true);
  const activeIndex = currentLayout === "compact" ? 0 : 1;
  setSelectedIndex(activeIndex);
  setWindowStart(0);
}

/**
 * Close the layout picker.
 */
export function closeLayoutPicker(
  input: { focus(): void } | undefined,
  setOpen: (value: boolean) => void,
  setSelectedIndex: (value: number) => void,
  setWindowStart: (value: number) => void
): void {
  setOpen(false);
  setSelectedIndex(0);
  setWindowStart(0);
  input?.focus();
}

export interface SubmitLayoutPickerSelectionOptions extends UiEntrySink {
  readonly configPath: string;
  readonly selectedIndex: number;
  readonly items: readonly LayoutPickerItem[];
  readonly setLayoutMode: (value: LayoutMode) => void;
  readonly setToolsCollapsed: (value: boolean) => void;
  readonly close: () => void;
}

/**
 * Select the highlighted layout picker item.
 */
export function submitSelectedLayoutPickerItem(options: SubmitLayoutPickerSelectionOptions): void {
  const selectedItem = options.items[options.selectedIndex];
  if (selectedItem === undefined) {
    return;
  }

  if (selectedItem.id === "collapse-tools") {
    const label = selectedItem.label;
    options.setToolsCollapsed(label.startsWith("Collapse"));
    appendStatusEntry(options, label.startsWith("Collapse") ? "Tool output collapsed" : "Tool output expanded");
    options.close();
    return;
  }

  const nextLayout = selectedItem.id as LayoutMode;
  try {
    persistLayoutMode(options.configPath, nextLayout);
    options.setLayoutMode(nextLayout);
    appendStatusEntry(options, `Switched to ${selectedItem.label} layout`);
    options.close();
  } catch (error) {
    appendErrorEntry(options, error);
  }
}

function persistSelectedTheme(configPath: string, themeName: ThemeName): void {
  const config = loadRecodeConfigFile(configPath);
  const nextConfig = selectConfiguredTheme(config, themeName);
  saveRecodeConfigFile(configPath, nextConfig);
}

export function persistSelectedApprovalMode(configPath: string, approvalMode: ApprovalMode): void {
  const config = loadRecodeConfigFile(configPath);
  const nextConfig = selectConfiguredApprovalMode(config, approvalMode);
  saveRecodeConfigFile(configPath, nextConfig);
}

/**
 * Cycle order used by the Ctrl+Y approval-mode hotkey.
 *
 * Mirrors the order shown in {@link buildApprovalModePickerItems} so the toggle
 * feels consistent with the picker.
 */
const APPROVAL_MODE_CYCLE: readonly ApprovalMode[] = ["approval", "auto-edits", "yolo"];

/**
 * Return the next approval mode in the Ctrl+Y cycle.
 */
export function getNextApprovalMode(currentMode: ApprovalMode): ApprovalMode {
  const index = APPROVAL_MODE_CYCLE.indexOf(currentMode);
  const nextIndex = (index === -1 ? 0 : index + 1) % APPROVAL_MODE_CYCLE.length;
  return APPROVAL_MODE_CYCLE[nextIndex] ?? "approval";
}

/**
 * Human-readable label for an approval mode, used by toasts and status rows.
 */
export function getApprovalModeLabel(mode: ApprovalMode): string {
  switch (mode) {
    case "approval":
      return "Approval";
    case "auto-edits":
      return "Auto-Edits";
    case "yolo":
      return "YOLO";
  }
}

function persistSelectedToolMarker(configPath: string, toolMarkerName: ToolMarkerName): void {
  const config = loadRecodeConfigFile(configPath);
  const nextConfig = selectConfiguredToolMarker(config, toolMarkerName);
  saveRecodeConfigFile(configPath, nextConfig);
}

function persistTodoPanelEnabled(configPath: string, enabled: boolean): void {
  const config = loadRecodeConfigFile(configPath);
  const nextConfig = selectConfiguredTodoPanelEnabled(config, enabled);
  saveRecodeConfigFile(configPath, nextConfig);
}

function persistRetainBashToolOutput(configPath: string, enabled: boolean): void {
  const config = loadRecodeConfigFile(configPath);
  const nextConfig = selectConfiguredRetainBashToolOutput(config, enabled);
  saveRecodeConfigFile(configPath, nextConfig);
}

function persistLayoutMode(configPath: string, mode: LayoutMode): void {
  const config = loadRecodeConfigFile(configPath);
  const nextConfig = selectConfiguredLayoutMode(config, mode);
  saveRecodeConfigFile(configPath, nextConfig);
}
