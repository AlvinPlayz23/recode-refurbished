/**
 * Helpers for producing updated Recode config objects.
 */

import type {
  ConfiguredAgent,
  ConfiguredProvider,
  RecodeConfigFile
} from "./recode-config.ts";
import type { LayoutMode, ThemeName, ToolMarkerName } from "../tui/appearance/theme.ts";
import type { ApprovalMode, PermissionRule, ToolApprovalScope } from "../tools/tool.ts";

/**
 * Config fields that can be updated while preserving the rest of the file.
 */
export interface RecodeConfigPatch {
  readonly activeProviderId?: string;
  readonly themeName?: ThemeName;
  readonly toolMarkerName?: ToolMarkerName;
  readonly approvalMode?: ApprovalMode;
  readonly approvalAllowlist?: readonly ToolApprovalScope[];
  readonly permissionRules?: readonly PermissionRule[];
  readonly layoutMode?: LayoutMode;
  readonly minimalMode?: boolean;
  readonly todoPanelEnabled?: boolean;
  readonly retainBashToolOutput?: boolean;
  readonly agents?: Readonly<Record<string, ConfiguredAgent>>;
  readonly providers?: readonly ConfiguredProvider[];
}

/**
 * Apply a partial config update without dropping unrelated persisted settings.
 */
export function patchRecodeConfig(
  config: RecodeConfigFile,
  patch: RecodeConfigPatch
): RecodeConfigFile {
  const activeProviderId = patch.activeProviderId ?? config.activeProviderId;
  const themeName = patch.themeName ?? config.themeName;
  const toolMarkerName = patch.toolMarkerName ?? config.toolMarkerName;
  const approvalMode = patch.approvalMode ?? config.approvalMode;
  const approvalAllowlist = patch.approvalAllowlist ?? config.approvalAllowlist;
  const permissionRules = patch.permissionRules ?? config.permissionRules;
  const layoutMode = patch.layoutMode ?? config.layoutMode;
  const minimalMode = patch.minimalMode ?? config.minimalMode;
  const todoPanelEnabled = patch.todoPanelEnabled ?? config.todoPanelEnabled;
  const retainBashToolOutput = patch.retainBashToolOutput ?? config.retainBashToolOutput;
  const agents = patch.agents ?? config.agents;

  return {
    version: config.version,
    providers: patch.providers ?? config.providers,
    ...(activeProviderId === undefined ? {} : { activeProviderId }),
    ...(themeName === undefined ? {} : { themeName }),
    ...(toolMarkerName === undefined ? {} : { toolMarkerName }),
    ...(approvalMode === undefined ? {} : { approvalMode }),
    ...(approvalAllowlist === undefined ? {} : { approvalAllowlist }),
    ...(permissionRules === undefined ? {} : { permissionRules }),
    ...(layoutMode === undefined ? {} : { layoutMode }),
    ...(minimalMode === undefined ? {} : { minimalMode }),
    ...(todoPanelEnabled === undefined ? {} : { todoPanelEnabled }),
    ...(retainBashToolOutput === undefined ? {} : { retainBashToolOutput }),
    ...(agents === undefined ? {} : { agents })
  };
}
