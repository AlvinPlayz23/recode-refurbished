/**
 * CLI diagnostics for Recode runtime setup.
 */

import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadRecodeConfigFile, type ConfiguredProvider } from "../config/recode-config.ts";
import { resolveHistoryRoot } from "../history/recode-history.ts";
import { listModelsForProvider } from "../models/list-models.ts";
import { providerSupportsModelListing } from "../providers/provider-kind.ts";
import type { RuntimeConfig } from "../runtime/runtime-config.ts";

/**
 * Run local setup checks and print a human-readable report.
 */
export async function runDoctor(runtimeConfig: RuntimeConfig): Promise<number> {
  const config = loadRecodeConfigFile(runtimeConfig.configPath);
  const activeProvider = config.providers.find((provider) => provider.id === runtimeConfig.providerId);
  const checks: DoctorCheck[] = [];

  checks.push({
    label: "Config file",
    ok: true,
    detail: runtimeConfig.configPath
  });
  checks.push({
    label: "Workspace",
    ok: true,
    detail: runtimeConfig.workspaceRoot
  });
  checks.push({
    label: "Active provider",
    ok: activeProvider !== undefined,
    detail: activeProvider === undefined
      ? `No enabled provider found for '${runtimeConfig.providerId}'.`
      : `${activeProvider.name} (${activeProvider.id}, ${activeProvider.kind})`
  });
  checks.push({
    label: "Selected model",
    ok: runtimeConfig.model.trim() !== "",
    detail: runtimeConfig.model
  });
  checks.push({
    label: "API key",
    ok: runtimeConfig.provider === "openai-oauth" || (runtimeConfig.apiKey !== undefined && runtimeConfig.apiKey.trim() !== ""),
    detail: runtimeConfig.provider === "openai-oauth"
      ? "Not required for openai-oauth"
      : runtimeConfig.apiKey === undefined || runtimeConfig.apiKey.trim() === ""
      ? "No API key configured. This is only OK for providers that do not require one."
      : "Configured"
  });
  checks.push({
    label: "Approval mode",
    ok: true,
    detail: runtimeConfig.approvalMode
  });
  checks.push(checkHistoryWritable(runtimeConfig.configPath));

  if (activeProvider !== undefined) {
    checks.push(await checkModelListing(activeProvider, runtimeConfig.providerId));
  }

  console.log("Recode doctor");
  console.log("");
  for (const check of checks) {
    console.log(`${check.ok ? "OK" : "WARN"}  ${check.label}: ${check.detail}`);
  }

  return checks.every((check) => check.ok) ? 0 : 1;
}

interface DoctorCheck {
  readonly label: string;
  readonly ok: boolean;
  readonly detail: string;
}

function checkHistoryWritable(configPath: string): DoctorCheck {
  const historyRoot = resolveHistoryRoot(configPath);
  const probePath = join(historyRoot, `.doctor-${crypto.randomUUID()}.tmp`);

  try {
    mkdirSync(dirname(probePath), { recursive: true });
    writeFileSync(probePath, "ok\n", "utf8");
    unlinkSync(probePath);
    return {
      label: "History directory",
      ok: true,
      detail: historyRoot
    };
  } catch (error) {
    return {
      label: "History directory",
      ok: false,
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

async function checkModelListing(
  provider: ConfiguredProvider,
  activeProviderId: string
): Promise<DoctorCheck> {
  if (!providerSupportsModelListing(provider.kind)) {
    return {
      label: "Model listing",
      ok: true,
      detail: `${provider.kind} does not expose an OpenAI-compatible /models endpoint.`
    };
  }

  const result = await listModelsForProvider(provider, activeProviderId, true);
  if (result.error !== undefined) {
    return {
      label: "Model listing",
      ok: false,
      detail: result.error
    };
  }

  return {
    label: "Model listing",
    ok: result.models.length > 0,
    detail: `${result.models.length} model(s) available`
  };
}
