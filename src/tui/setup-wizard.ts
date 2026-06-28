/**
 * pi-tui based interactive setup wizard for Recode providers and models.
 *
 * Replaces the readline-based prompt loop with a themed overlay wizard
 * when running on an interactive TTY. Falls back to the readline flow
 * in non-interactive environments.
 *
 * Architecture follows the same callback-driven pattern as TuiApp:
 * no step loops, no tight async spinning. Each step shows an overlay,
 * the promise resolves when the user selects, and the .then() handler
 * chains to the next step.
 *
 * @author dev
 */

import chalk from "chalk";
import {
  CancellableLoader,
  Input,
  SelectList,
  Text,
  TUI,
  ProcessTerminal,
  matchesKey,
  type Component,
  type Focusable,
  type SelectItem,
  type SelectListTheme,
  type OverlayHandle,
  type OverlayOptions
} from "./pi-tui/index.ts";
import {
  loadRecodeConfigFile,
  resolveConfigPath,
  saveRecodeConfigFile,
  upsertConfiguredProvider,
  type RecodeConfigFile,
  type ConfiguredModel,
  type ConfiguredProvider
} from "../config/recode-config.ts";
import { fetchOpenAiCompatibleModels, fetchOpenAiOAuthModels } from "../models/list-models.ts";
import { authenticateOpenAiOAuthFromInput, createOpenAiOAuthAuthorizationUrl } from "../providers/openai-oauth-auth.ts";
import {
  getDefaultProviderBaseUrl,
  getDefaultProviderName,
  providerSupportsModelListing,
  PROVIDER_PRESETS,
  type ProviderKind
} from "../providers/provider-kind.ts";
import {
  DEFAULT_THEME_NAME,
  getTheme,
  type ThemeColors
} from "./appearance/theme.ts";

// ---------------------------------------------------------------------------
// Selection theme factory
// ---------------------------------------------------------------------------

function createSelectTheme(theme: ThemeColors): SelectListTheme {
  return {
    selectedPrefix: (text) => chalk.hex(theme.active)(text),
    selectedText: (text) => chalk.hex(theme.inverseText).bgHex(theme.active)(text),
    description: (text) => chalk.hex(theme.subtle)(text),
    scrollInfo: (text) => chalk.hex(theme.hintText)(text),
    noMatch: (text) => chalk.hex(theme.error)(text)
  };
}

// ---------------------------------------------------------------------------
// Bordered card component
// ---------------------------------------------------------------------------

class WizardCard implements Component {
  private readonly titleLines: string[];
  private readonly child: Component;

  constructor(
    title: string,
    child: Component,
    private readonly theme: ThemeColors
  ) {
    this.titleLines = title
      .split("\n")
      .flatMap((line) => line.trim() === "" ? [] : [line.trim()]);
    this.child = child;
  }

  handleInput(data: string): void {
    this.child.handleInput?.(data);
  }

  invalidate(): void {
    this.child.invalidate();
  }

  render(width: number): string[] {
    const innerWidth = Math.max(8, width - 4);
    const contentLines = this.child.render(innerWidth);
    const border = chalk.hex(this.theme.divider);

    const lines: string[] = [];
    lines.push(border(`╭${"─".repeat(width - 2)}╮`));

    for (const titleLine of this.titleLines) {
      lines.push(this.wrapLine(border, chalk.hex(this.theme.brand).bold(titleLine), innerWidth));
    }
    if (this.titleLines.length > 0) {
      lines.push(this.wrapLine(border, border("─".repeat(innerWidth)), innerWidth));
    }

    for (const contentLine of contentLines) {
      lines.push(this.wrapLine(border, contentLine, innerWidth));
    }

    lines.push(border(`╰${"─".repeat(width - 2)}╯`));
    return lines;
  }

  private wrapLine(border: (text: string) => string, line: string, innerWidth: number): string {
    const stripped = line.replace(/\x1B\[[0-9;]*m/g, "");
    const pad = Math.max(0, innerWidth - stripped.length);
    return `${border("│")} ${line}${" ".repeat(pad)} ${border("│")}`;
  }
}

// ---------------------------------------------------------------------------
// Select step component
// ---------------------------------------------------------------------------

class SelectStepComponent implements Component, Focusable {
  readonly #card: WizardCard;
  readonly #list: SelectList;
  focused = true;
  onSelect?: (item: SelectItem) => void;

  constructor(title: string, items: readonly SelectItem[], maxVisible: number, theme: ThemeColors) {
    this.#list = new SelectList([...items], maxVisible, createSelectTheme(theme));
    this.#list.onSelect = (item) => this.onSelect?.(item);
    this.#card = new WizardCard(title, this.#list, theme);
  }

  get list(): SelectList {
    return this.#list;
  }

  handleInput(data: string): void { this.#card.handleInput(data); }
  invalidate(): void { this.#card.invalidate(); }
  render(width: number): string[] { return this.#card.render(width); }
}

// ---------------------------------------------------------------------------
// Input step component
// ---------------------------------------------------------------------------

class InputStepComponent implements Component, Focusable {
  readonly #card: WizardCard;
  readonly #input: Input;
  focused = true;
  onSubmit?: (value: string) => void;

  constructor(title: string, defaultValue: string | undefined, theme: ThemeColors) {
    this.#input = new Input();
    if (defaultValue !== undefined && defaultValue !== "") {
      this.#input.setValue(defaultValue);
    }
    this.#input.onSubmit = (value) => {
      const resolved = value.trim() === "" ? (defaultValue ?? "") : value.trim();
      this.onSubmit?.(resolved);
    };
    const child = new InputWithHint(this.#input, defaultValue);
    this.#card = new WizardCard(title, child, theme);
  }

  handleInput(data: string): void { this.#card.handleInput(data); }
  invalidate(): void { this.#card.invalidate(); }
  render(width: number): string[] { return this.#card.render(width); }
}

// ---------------------------------------------------------------------------
// Input layout with hint line
// ---------------------------------------------------------------------------

class InputWithHint implements Component {
  constructor(private readonly input: Input, private readonly defaultValue: string | undefined) {}

  handleInput(data: string): void { this.input.handleInput(data); }
  invalidate(): void { this.input.invalidate(); }

  render(width: number): string[] {
    const inputLines = this.input.render(width);
    const hint = this.defaultValue !== undefined && this.defaultValue !== ""
      ? `  ${chalk.hex("#888")(`Press Enter to keep: ${this.defaultValue}`)}`
      : `  ${chalk.hex("#888")("Type a value and press Enter")}`;
    return [...inputLines, "", hint];
  }
}

// ---------------------------------------------------------------------------
// Welcome layout
// ---------------------------------------------------------------------------

class WelcomeLayout implements Component {
  constructor(private readonly content: Component, private readonly button: Component) {}

  handleInput(data: string): void { this.button.handleInput?.(data); }
  invalidate(): void { this.content.invalidate(); this.button.invalidate(); }
  render(width: number): string[] { return [...this.content.render(width), ...this.button.render(width)]; }
}

// ---------------------------------------------------------------------------
// FocusableWrapper
// ---------------------------------------------------------------------------

class FocusableWrapper implements Component, Focusable {
  focused = true;
  constructor(private readonly inner: Component) {}
  handleInput(data: string): void { this.inner.handleInput?.(data); }
  invalidate(): void { this.inner.invalidate(); }
  render(width: number): string[] { return this.inner.render(width); }
}

function asFocusable(component: Component): Component & Focusable {
  return new FocusableWrapper(component);
}

// ---------------------------------------------------------------------------
// Main wizard class — purely callback-driven, like TuiApp.
// ---------------------------------------------------------------------------

const MAX_VISIBLE = 10;

export class SetupWizardApp {
  private readonly tui: TUI;
  private readonly exitPromise: Promise<boolean>;
  private resolveExit!: (saved: boolean) => void;
  private currentOverlay: OverlayHandle | undefined;
  private loaderBusy = false;
  private ctrlCArmed = false;
  private ctrlCTimer: ReturnType<typeof setTimeout> | undefined;
  private stopped = false;
  private readonly loader: CancellableLoader;
  private readonly theme: ThemeColors;

  // Mutable wizard state
  private config: RecodeConfigFile;
  private readonly configPath: string;
  private provider: Partial<ConfiguredProvider> = {};
  private makeActive: boolean;
  private providerKind: ProviderKind | undefined;

  constructor(configPath: string, config: RecodeConfigFile) {
    const terminal = new ProcessTerminal();
    this.tui = new TUI(terminal, false);
    this.configPath = configPath;
    this.config = config;
    this.makeActive = config.providers.length === 0;
    this.theme = getTheme(DEFAULT_THEME_NAME);

    this.loader = new CancellableLoader(
      this.tui,
      (text) => chalk.hex(this.theme.active)(text),
      (text) => chalk.hex(this.theme.hintText)(text),
      ""
    );

    this.exitPromise = new Promise<boolean>((resolve) => {
      this.resolveExit = resolve;
    });
  }

  /**
   * Start the wizard and return whether config was saved.
   * Follows the same start pattern as TuiApp: start TUI, render, fire off
   * the first step, and wait for the exit promise.
   */
  async run(): Promise<boolean> {
    this.tui.addInputListener((data) => {
      if (matchesKey(data, "ctrl+c")) {
        this.handleCtrlC();
        return { consume: true };
      }
      return undefined;
    });
    this.tui.start();
    this.syncRender();
    this.stepWelcome();
    return this.exitPromise;
  }

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------

  private syncRender(): void {
    this.tui.clear();
    for (const line of this.renderBackground()) {
      this.tui.addChild(new Text(line));
    }
    if (this.loaderBusy) {
      this.tui.addChild(this.loader);
    }
    this.tui.requestRender(true);
  }

  private renderBackground(): string[] {
    const theme = this.theme;
    const lines: string[] = [];
    lines.push("");
    lines.push(chalk.hex(theme.brand).bold("  Recode Setup"));
    lines.push(chalk.hex(theme.subtle)(`  ${this.configPath}`));
    lines.push("");
    const progress = this.renderProgress();
    lines.push(progress);
    lines.push("");
    return lines;
  }

  private renderProgress(): string {
    const theme = this.theme;
    const steps = [
      "Welcome", "Provider", "Kind", "Details",
      "Options", "Models", "Activate", "Done"
    ];
    const done = this.getProgressDone();
    const filled = "━".repeat(done);
    const empty = "─".repeat(Math.max(0, steps.length - done));
    return `  ${chalk.hex(theme.subtle)("Step")} ${chalk.hex(theme.brand)(filled)}${chalk.hex(theme.divider)(empty)} ${chalk.hex(theme.subtle)(`${done}/${steps.length}`)}`;
  }

  private getProgressDone(): number {
    // Approximate progress based on how many fields are filled
    let score = 0;
    if (this.provider.id !== undefined) score++;
    if (this.provider.kind !== undefined) score++;
    if (this.provider.baseUrl !== undefined) score++;
    if (this.provider.apiKey !== undefined) score++;
    if (this.provider.toolChoice !== undefined) score++;
    if (this.provider.models !== undefined && this.provider.models.length > 0) score++;
    if (this.provider.defaultModelId !== undefined) score++;
    return Math.min(score, 8);
  }

  // -------------------------------------------------------------------------
  // Overlay helpers — same pattern as TuiApp.selectOverlay
  // -------------------------------------------------------------------------

  private showOverlay(component: Component & Focusable, options?: OverlayOptions): OverlayHandle {
    const handle = this.tui.showOverlay(component, {
      anchor: "center",
      width: "75%",
      maxHeight: "70%",
      margin: 2,
      ...options
    });
    this.currentOverlay = handle;
    handle.focus();
    return handle;
  }

  private hideCurrentOverlay(): void {
    this.currentOverlay?.hide();
    this.currentOverlay = undefined;
  }

  /**
   * Show a select overlay. Returns a Promise that resolves when the user
   * picks an item or cancels. Exactly the same shape as TuiApp.selectOverlay.
   */
  private selectOverlay(
    title: string,
    items: readonly SelectItem[]
  ): Promise<string> {
    return new Promise<string>((resolve) => {
      const step = new SelectStepComponent(title, items, MAX_VISIBLE, this.theme);
      step.list.setSelectedIndex(0);
      const handle = this.showOverlay(step);
      step.onSelect = (item) => {
        handle.hide();
        resolve(item.value);
      };
    });
  }

  /**
   * Show a text input overlay. Returns a Promise that resolves when the
   * user submits or presses Escape (returns undefined = go back).
   */
  private inputOverlay(
    title: string,
    defaultValue: string | undefined
  ): Promise<string | undefined> {
    return new Promise<string | undefined>((resolve) => {
      const step = new InputStepComponent(title, defaultValue, this.theme);
      const handle = this.showOverlay(step);
      step.onSubmit = (value) => {
        handle.hide();
        resolve(value);
      };
    });
  }

  private showLoader(text: string): void {
    this.loader.setText(text);
    this.loader.start();
    this.loaderBusy = true;
    this.syncRender();
  }

  private hideLoader(): void {
    this.loader.stop();
    this.loaderBusy = false;
    this.syncRender();
  }

  // -------------------------------------------------------------------------
  // Ctrl+C
  // -------------------------------------------------------------------------

  private handleCtrlC(): void {
    if (this.stopped) return;
    if (this.ctrlCArmed) {
      this.cleanup();
      this.resolveExit(false);
      return;
    }
    this.ctrlCArmed = true;
    if (this.ctrlCTimer !== undefined) clearTimeout(this.ctrlCTimer);
    this.ctrlCTimer = setTimeout(() => {
      this.ctrlCArmed = false;
      this.ctrlCTimer = undefined;
    }, 1800);
  }

  private cleanup(): void {
    this.stopped = true;
    this.hideCurrentOverlay();
    this.loader.stop();
    this.loaderBusy = false;
    this.tui.stop();
  }

  private finish(saved: boolean): void {
    this.cleanup();
    this.resolveExit(saved);
  }

  // =========================================================================
  // Wizard steps — each shows an overlay, chains the next via .then()
  // =========================================================================

  // -- Welcome -------------------------------------------------------------

  private stepWelcome(): void {
    const theme = this.theme;
    const content = [
      "",
      chalk.hex(theme.brand).bold("  ╔═══════════════════════════════════════════╗"),
      chalk.hex(theme.brand).bold("  ║") +
        chalk.hex(theme.brandShimmer).bold("        Recode Provider Setup              ") +
        chalk.hex(theme.brand).bold("║"),
      chalk.hex(theme.brand).bold("  ╚═══════════════════════════════════════════╝"),
      "",
      chalk.hex(theme.text)("  Configure a model provider so Recode can talk to an LLM."),
      "",
      chalk.hex(theme.subtle)("  Supported providers:")
    ];
    for (const preset of PROVIDER_PRESETS) {
      content.push(
        `    ${chalk.hex(theme.tool)("·")} ${chalk.hex(theme.text)(preset.label)} ${chalk.hex(theme.subtle)(`— ${preset.setupHint}`)}`
      );
    }
    content.push("");
    content.push(chalk.hex(theme.hintText)("  Press Ctrl+C twice to cancel."));

    const continueButton = new SelectList(
      [{ value: "continue", label: "Continue", description: "Start the setup wizard" }],
      1,
      createSelectTheme(theme)
    );
    const layout = new WelcomeLayout(new Text(content.join("\n"), 0, 0), continueButton);
    const card = new WizardCard("", layout, theme);
    const focusable = asFocusable(card);
    const handle = this.showOverlay(focusable, { width: "82%" });

    continueButton.onSelect = () => {
      handle.hide();
      this.stepSelectProvider();
    };
  }

  // -- Select provider (existing or new) -----------------------------------

  private stepSelectProvider(): void {
    const items: SelectItem[] = [
      {
        value: "__new__",
        label: "+  Create a new provider",
        description: "Add a new provider to your config"
      },
      ...this.config.providers.map((p) => ({
        value: p.id,
        label: p.name,
        description: `${p.id} · ${p.kind}${p.id === this.config.activeProviderId ? " · active" : ""}${p.disabled === true ? " · disabled" : ""}`
      }))
    ];
    this.selectOverlay("Choose a provider to configure", items).then((selected) => {
      if (selected === "__new__") {
        this.provider = {};
        this.stepSelectKind();
      } else {
        const existing = this.config.providers.find((p) => p.id === selected);
        if (existing !== undefined) {
          this.provider = { ...existing };
          this.providerKind = existing.kind;
          this.syncRender();
          this.stepProviderId();
        }
      }
    });
  }

  // -- Select provider kind ------------------------------------------------

  private stepSelectKind(): void {
    const items: SelectItem[] = PROVIDER_PRESETS.map((preset) => ({
      value: preset.kind,
      label: preset.label,
      description: preset.setupHint
    }));
    this.selectOverlay("Select provider kind", items).then((selected) => {
      const kind = selected as ProviderKind;
      const preset = PROVIDER_PRESETS.find((p) => p.kind === kind);
      this.providerKind = kind;
      this.provider = {
        ...this.provider,
        kind,
        baseUrl: preset?.defaultBaseUrl ?? "",
        name: preset?.defaultName ?? ""
      };
      this.syncRender();
      this.stepProviderId();
    });
  }

  // -- Text fields ---------------------------------------------------------

  private stepProviderId(): void {
    const defaultId = this.provider.id
      ?? normalizeProviderId(this.provider.kind ?? this.providerKind ?? "provider");
    this.inputOverlay(
      "Provider ID\nUsed to identify this provider in your config.",
      defaultId
    ).then((value) => {
      if (value === undefined) { this.stepSelectProvider(); return; }
      this.provider = { ...this.provider, id: value.toLowerCase().trim() };
      this.syncRender();
      this.stepProviderName();
    });
  }

  private stepProviderName(): void {
    const defaultName = this.provider.name
      ?? getDefaultProviderName(this.providerKind ?? "openai");
    this.inputOverlay("Provider Name\nA human-readable label.", defaultName).then((value) => {
      if (value === undefined) { this.stepProviderId(); return; }
      this.provider = { ...this.provider, name: value };
      this.syncRender();
      this.stepBaseUrl();
    });
  }

  private stepBaseUrl(): void {
    const defaultUrl = this.provider.baseUrl
      ?? getDefaultProviderBaseUrl(this.providerKind ?? "openai");
    this.inputOverlay("Base URL\nThe API endpoint for this provider.", defaultUrl).then((value) => {
      if (value === undefined) { this.stepProviderName(); return; }
      this.provider = { ...this.provider, baseUrl: value };
      this.syncRender();
      this.stepApiKey();
    });
  }

  private stepApiKey(): void {
    this.inputOverlay(
      "API Key\nLeave blank if the provider does not require one.",
      this.provider.apiKey
    ).then((value) => {
      if (value === undefined) { this.stepBaseUrl(); return; }
      const apiKey = value === "" ? undefined : value;
      this.provider = { ...this.provider, ...(apiKey === undefined ? {} : { apiKey }) };
      this.syncRender();
      if (this.providerKind === "openai-oauth") {
        this.stepOAuthCallback();
      } else {
        this.stepToolChoice();
      }
    });
  }

  private stepOAuthCallback(): void {
    void createOpenAiOAuthAuthorizationUrl().then((flow) => {
      const title = [
        "OpenAI Codex OAuth Login",
        "",
        "Open this URL, complete login, then paste the callback URL or code:",
        chalk.hex(this.theme.suggestion)(flow.url)
      ].join("\n");

      this.inputOverlay(title, undefined).then((value) => {
        if (value === undefined) { this.stepApiKey(); return; }
        void authenticateOpenAiOAuthFromInput(value, flow.verifier)
          .catch(() => {})
          .finally(() => { this.stepToolChoice(); });
      });
    }).catch(() => {
      this.stepToolChoice();
    });
  }

  private stepToolChoice(): void {
    const defaultVal = this.provider.toolChoice;
    const items: SelectItem[] = [
      { value: "__default__", label: "Provider default", description: "Do not force a tool-choice mode" },
      { value: "auto", label: "Auto", description: "Let the model decide when to call tools" },
      { value: "required", label: "Required", description: "Prefer tool-calling when tools are available" }
    ];
    const defaultIndex = defaultVal === "required" ? 2 : defaultVal === "auto" ? 1 : 0;
    const step = new SelectStepComponent("Preferred tool choice mode", items, MAX_VISIBLE, this.theme);
    step.list.setSelectedIndex(defaultIndex);
    const handle = this.showOverlay(step);
    step.onSelect = (item) => {
      handle.hide();
      const toolChoice = item.value === "__default__" ? undefined : (item.value as "auto" | "required");
      this.provider = { ...this.provider, ...(toolChoice === undefined ? {} : { toolChoice }) };
      this.syncRender();
      this.stepFetchModels();
    };
  }

  // -- Fetch models --------------------------------------------------------

  private stepFetchModels(): void {
    const kind = this.providerKind ?? this.provider.kind;
    if (kind === undefined || !providerSupportsModelListing(kind)) {
      this.stepManualModels();
      return;
    }

    this.selectOverlay(
      "How should models be added?",
      [
        { value: "fetch", label: "Fetch from /models", description: "Query the provider for available models" },
        { value: "manual", label: "Enter model IDs manually", description: "Type model IDs separated by commas" }
      ]
    ).then((selected) => {
      if (selected === "manual") {
        this.stepManualModels();
        return;
      }

      this.showLoader("Fetching models from provider...");
      const fetchPromise = kind === "openai-oauth"
        ? fetchOpenAiOAuthModels({ baseUrl: this.provider.baseUrl ?? "" })
        : fetchOpenAiCompatibleModels({
            baseUrl: this.provider.baseUrl ?? "",
            ...(this.provider.apiKey === undefined || this.provider.apiKey === ""
              ? {} : { apiKey: this.provider.apiKey })
          });

      fetchPromise.then((remoteModels) => {
        this.hideLoader();
        if (remoteModels.length === 0) {
          this.stepManualModels();
          return;
        }
        const merged = mergeModelsPreservingMetadata(this.provider.models ?? [], remoteModels);
        this.provider = { ...this.provider, models: merged };
        this.syncRender();
        this.stepSelectModel(merged);
      }).catch(() => {
        this.hideLoader();
        this.stepManualModels();
      });
    });
  }

  // -- Manual model entry --------------------------------------------------

  private stepManualModels(): void {
    const models = this.provider.models ?? [];
    if (models.length > 0) {
      this.stepSelectModel(models);
      return;
    }

    const existingIds = models.map((m) => m.id).join(", ") || undefined;
    this.inputOverlay("Model IDs\nComma-separated model IDs to store.", existingIds).then((value) => {
      if (value === undefined) { this.stepFetchModels(); return; }
      const parsed = parseManualModels(value);
      const merged = mergeModelsPreservingMetadata(this.provider.models ?? [], parsed);
      this.provider = { ...this.provider, models: merged };
      this.syncRender();
      this.stepSelectModel(merged);
    });
  }

  // -- Select model --------------------------------------------------------

  private stepSelectModel(models: readonly ConfiguredModel[]): void {
    const items: SelectItem[] = [
      ...models.slice(0, 50).map((model) => ({
        value: model.id,
        label: model.id,
        description: model.label ?? ""
      })),
      { value: "__custom__", label: "Enter a custom model ID", description: "Type a model ID not shown above" }
    ];

    const defaultIndex = models.findIndex(
      (model) => model.id === (this.provider.defaultModelId ?? models[0]?.id)
    );

    this.selectOverlay("Select the default model", items).then((selected) => {
      if (selected === "__custom__") {
        this.inputOverlay("Custom Model ID", undefined).then((custom) => {
          if (custom === undefined) { this.stepSelectModel(models); return; }
          this.applySelectedModel(models, custom);
        });
      } else {
        this.applySelectedModel(models, selected);
      }
    });
  }

  private applySelectedModel(models: readonly ConfiguredModel[], modelId: string): void {
    const allModels = models.some((m) => m.id === modelId)
      ? models
      : [...models, { id: modelId }];
    this.provider = { ...this.provider, models: allModels, defaultModelId: modelId };
    this.syncRender();
    this.stepContextWindow(modelId);
  }

  // -- Context window ------------------------------------------------------

  private stepContextWindow(modelId: string): void {
    const existingModel = (this.provider.models ?? []).find((m) => m.id === modelId);
    const defaultVal = existingModel?.contextWindowTokens?.toString();

    this.inputOverlay(
      `Context Window Tokens for '${modelId}'\nLeave blank if unknown.`,
      defaultVal
    ).then((value) => {
      if (value === undefined) { this.stepSelectModel(this.provider.models ?? []); return; }
      const parsed = value === "" ? undefined : Number.parseInt(value, 10);
      if (parsed !== undefined && Number.isFinite(parsed) && parsed > 0) {
        const models = (this.provider.models ?? []).map((m) =>
          m.id === modelId ? { ...m, contextWindowTokens: parsed } : m
        );
        this.provider = { ...this.provider, models };
      }
      this.syncRender();
      this.stepMakeActive();
    });
  }

  // -- Make active ---------------------------------------------------------

  private stepMakeActive(): void {
    const isFirst = this.config.providers.length === 0;
    const isAlreadyActive = this.provider.id === this.config.activeProviderId;
    this.selectOverlay(
      "Set this as the active provider?",
      [
        { value: "yes", label: "Yes", description: isFirst || isAlreadyActive ? "(default)" : "" },
        { value: "no", label: "No", description: !isFirst && !isAlreadyActive ? "(default)" : "" }
      ]
    ).then((selected) => {
      this.makeActive = selected === "yes";
      this.syncRender();
      this.stepAddAnother();
    });
  }

  // -- Add another ---------------------------------------------------------

  private stepAddAnother(): void {
    this.saveCurrentProvider();
    this.selectOverlay(
      "Add another provider?",
      [
        { value: "yes", label: "Yes", description: "" },
        { value: "no", label: "No", description: "(default)" }
      ]
    ).then((selected) => {
      if (selected === "yes") {
        this.provider = {};
        this.providerKind = undefined;
        this.syncRender();
        this.stepSelectProvider();
      } else {
        this.saveConfig();
        this.finish(true);
      }
    });
  }

  // -- Persistence ---------------------------------------------------------

  private saveCurrentProvider(): void {
    const wp = this.provider;
    if (wp.id === undefined || wp.name === undefined || wp.kind === undefined || wp.baseUrl === undefined) {
      return;
    }
    const provider: ConfiguredProvider = {
      id: wp.id,
      name: wp.name,
      kind: wp.kind,
      baseUrl: wp.baseUrl,
      models: wp.models ?? [],
      ...(wp.defaultModelId === undefined ? {} : { defaultModelId: wp.defaultModelId }),
      ...(wp.apiKey === undefined ? {} : { apiKey: wp.apiKey }),
      ...(wp.headers === undefined ? {} : { headers: wp.headers }),
      ...(wp.options === undefined ? {} : { options: wp.options }),
      ...(wp.maxOutputTokens === undefined ? {} : { maxOutputTokens: wp.maxOutputTokens }),
      ...(wp.temperature === undefined ? {} : { temperature: wp.temperature }),
      ...(wp.toolChoice === undefined ? {} : { toolChoice: wp.toolChoice }),
      ...(wp.disabled === undefined ? {} : { disabled: wp.disabled })
    };
    this.config = upsertConfiguredProvider(this.config, provider, this.makeActive);
  }

  private saveConfig(): void {
    saveRecodeConfigFile(this.configPath, this.config);
  }
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

function normalizeProviderId(value: string): string {
  return value.trim().toLowerCase().replaceAll(/\s+/g, "-");
}

function parseManualModels(value: string): readonly ConfiguredModel[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "")
    .map((id) => ({ id }));
}

function mergeModelsPreservingMetadata(
  existingModels: readonly ConfiguredModel[],
  nextModels: readonly ConfiguredModel[]
): readonly ConfiguredModel[] {
  const merged = new Map<string, ConfiguredModel>();
  for (const model of existingModels) {
    merged.set(model.id, model);
  }
  for (const model of nextModels) {
    const existing = merged.get(model.id);
    merged.set(model.id, {
      ...(existing ?? {}),
      ...model,
      ...(existing?.contextWindowTokens === undefined
        ? {}
        : { contextWindowTokens: existing.contextWindowTokens })
    });
  }
  return [...merged.values()];
}
