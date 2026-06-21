/**
 * Imperative pi-tui application shell for Recode.
 */

import chalk from "chalk";
import { runAgentLoop } from "../agent/run-agent-loop.ts";
import { estimateConversationContextTokens } from "../agent/compact-conversation.ts";
import { createLanguageModel } from "../models/create-model-client.ts";
import { listModelsForProvider } from "../models/list-models.ts";
import {
  loadRecodeConfigFile,
  saveRecodeConfigFile,
  selectConfiguredApprovalMode,
  selectConfiguredProviderModel,
  selectConfiguredTheme
} from "../config/recode-config.ts";
import {
  createConversationRecord,
  listHistoryForWorkspace,
  loadConversation,
  loadHistoryIndex,
  markConversationAsCurrent,
  resolveHistoryRoot,
  saveConversation,
  type SavedConversationRecord
} from "../history/recode-history.ts";
import { exportConversationToHtml, exportConversationToMarkdown } from "../history/export-html.ts";
import { PLAN_SYSTEM_PROMPT } from "../prompt/plan-system-prompt.ts";
import type { SessionEvent } from "../session/session-event.ts";
import { applySessionEvent, createEmptySessionState, type SessionState } from "../session/session-state.ts";
import type { ConversationMessage } from "../transcript/message.ts";
import type {
  ApprovalMode,
  QuestionAnswer,
  QuestionToolDecision,
  QuestionToolRequest,
  ToolApprovalDecision,
  ToolApprovalRequest,
  ToolExecutionContext
} from "../tools/tool.ts";
import type { RuntimeConfig } from "../runtime/runtime-config.ts";
import { selectRuntimeProviderModel } from "../runtime/runtime-config.ts";
import { buildBuiltinConfigBody, buildBuiltinHelpBody, buildBuiltinStatusBody } from "./builtin-command-content.ts";
import { getBuiltinCommands, parseBuiltinCommand } from "./message-format.ts";
import { buildPlanModeModelPrompt } from "./session/plan-review.ts";
import { getSessionModeLabel, type SessionMode } from "./session/session-mode.ts";
import { createToolRegistryForMode } from "./session/tool-registry-mode.ts";
import { createMarkdownSyntaxStyle } from "./appearance/markdown-style.ts";
import {
  DEFAULT_THEME_NAME,
  getAvailableThemes,
  getTheme,
  getThemeDefinition,
  isThemeName,
  type ThemeColors,
  type ThemeName
} from "./appearance/theme.ts";
import { createEntry, rehydrateEntriesFromSessionEvents, rehydrateEntriesFromTranscript, uiEntriesFromSessionState, type UiEntry } from "./transcript/transcript-entry-state.ts";
import {
  CancellableLoader,
  CombinedAutocompleteProvider,
  Editor,
  Markdown,
  SelectList,
  Text,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type Component,
  type EditorTheme,
  type SelectItem,
  type SelectListTheme,
  type SlashCommand,
  type TUI
} from "./pi-tui/index.ts";
import type { TuiRunOptions } from "./run-tui.ts";

const MAX_RETAINED_SESSION_EVENTS = 800;

/** Imperative TUI application controller. */
export class TuiApp {
  private runtimeConfig: RuntimeConfig;
  private toolContext: ToolExecutionContext;
  private previousMessages: readonly ConversationMessage[] = [];
  private transcript: readonly ConversationMessage[] = [];
  private sessionEvents: readonly SessionEvent[] = [];
  private sessionState: SessionState = createEmptySessionState();
  private sessionMode: SessionMode = "build";
  private entries: readonly UiEntry[] = [];
  private currentConversation: SavedConversationRecord | undefined;
  private busy = false;
  private busyPhase: "thinking" | "tool" | "retrying" = "thinking";
  private providerStatusText: string | undefined;
  private themeName: ThemeName;
  private theme: ThemeColors;
  private readonly historyRoot: string;
  private readonly editor: Editor;
  private readonly loader: CancellableLoader;
  private readonly exitPromise: Promise<void>;
  private resolveExit!: () => void;
  private abortController: AbortController | undefined;
  private ctrlCArmed = false;
  private ctrlCTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly tui: TUI, private readonly options: TuiRunOptions) {
    this.runtimeConfig = options.runtimeConfig;
    this.toolContext = options.toolContext;
    this.historyRoot = resolveHistoryRoot(this.runtimeConfig.workspaceRoot);
    this.themeName = readConfiguredTheme(this.runtimeConfig.configPath);
    this.theme = getTheme(this.themeName);
    this.editor = new Editor(tui, this.createEditorTheme(), { paddingX: 1 });
    this.loader = new CancellableLoader(
      tui,
      (text) => chalk.hex(this.theme.active)(text),
      (text) => chalk.hex(this.theme.hintText)(text),
      ""
    );
    this.loader.onAbort = () => this.abortCurrentRun();
    this.editor.setAutocompleteProvider(this.createAutocompleteProvider());
    this.applyComposerTheme();
    this.editor.onSubmit = (text) => void this.handleSubmit(text);
    this.exitPromise = new Promise((resolve) => {
      this.resolveExit = resolve;
    });
  }

  /** Start the TUI runtime. */
  start(): void {
    this.tui.addInputListener((data) => {
      if (matchesKey(data, "ctrl+c")) {
        this.handleCtrlC();
        return { consume: true };
      }
      return undefined;
    });
    this.tui.start();
    this.tui.setFocus(this.editor);
    this.syncRender();
  }

  /** Wait until the TUI exits. */
  async waitForExit(): Promise<void> {
    await this.exitPromise;
  }

  private syncRender(): void {
    this.tui.clear();
    for (const component of this.buildComponents()) {
      this.tui.addChild(component);
    }
    this.tui.addChild(this.editor);
    this.tui.setFocus(this.editor);
    this.tui.requestRender(true);
  }

  private buildComponents(): Component[] {
    const components: Component[] = [];
    components.push(new Text(this.renderHeader(), 1, 0));
    for (const entry of this.entries) {
      components.push(this.createEntryComponent(entry));
    }
    if (this.busy) {
      this.loader.setText(this.busyLabel());
      components.push(this.loader);
    }
    return components;
  }

  private renderHeader(): string {
    const theme = getThemeDefinition(this.themeName);
    return [
      chalk.hex(this.theme.brand).bold("Recode"),
      chalk.hex(this.theme.subtle)(`${this.runtimeConfig.providerName} · ${this.runtimeConfig.model} · ${theme.label} · ${getSessionModeLabel(this.sessionMode)} · approval ${this.runtimeConfig.approvalMode}`),
      chalk.hex(this.theme.divider)("─".repeat(48))
    ].join("\n");
  }

  private createEntryComponent(entry: UiEntry): Component {
    const title = entry.title === "" ? entry.kind : entry.title;
    switch (entry.kind) {
      case "assistant":
        return new Markdown(entry.body, 1, 1, createMarkdownSyntaxStyle(this.theme));
      case "user":
        return new Text(`${chalk.hex(this.theme.user).bold("You")}\n${entry.body}`, 1, 1);
      case "error":
        return new Text(`${chalk.hex(this.theme.error).bold(title)}\n${entry.body}`, 1, 1);
      case "tool":
      case "tool-preview":
      case "tool-group":
        return new Text(`${chalk.hex(this.theme.tool)(title)} ${entry.toolStatus === "running" ? chalk.hex(this.theme.warning)("running") : ""}\n${entry.body}`, 1, 0);
      case "reasoning":
        return new Text(chalk.gray.italic(entry.body), 1, 0);
      case "status":
        return new Text(`${chalk.hex(this.theme.subtle)(title)}\n${entry.body}`, 1, 0);
    }
  }

  private async handleSubmit(rawText: string): Promise<void> {
    const text = rawText.trim();
    this.editor.setText("");
    if (text === "") {
      this.syncRender();
      return;
    }
    this.editor.addToHistory(text);

    if (text.startsWith("/")) {
      await this.handleCommand(text);
      return;
    }

    await this.runPrompt(text);
  }

  private async handleCommand(text: string): Promise<void> {
    const command = parseBuiltinCommand(text);
    if (command === undefined) {
      this.appendEntry(createEntry("error", "error", `Unknown command: ${text}`));
      return;
    }

    switch (command.name) {
      case "exit":
      case "quit":
        this.exit();
        return;
      case "help":
        this.appendEntry(createEntry("assistant", "Recode", buildBuiltinHelpBody()));
        return;
      case "status":
        this.appendEntry(createEntry("assistant", "Recode", buildBuiltinStatusBody(this.runtimeConfig, "arrow", this.sessionMode, this.entries.length, this.transcript.length, this.transcript, {
          contextWindowTokens: this.runtimeConfig.contextWindowTokens ?? 200_000,
          source: this.runtimeConfig.contextWindowTokens === undefined ? "fallback" : "configured",
          reservedTokens: 20_000,
          lastEstimate: estimateConversationContextTokens(this.transcript),
          autoCompactionActive: false
        })));
        return;
      case "config":
        this.appendEntry(createEntry("assistant", "Recode", buildBuiltinConfigBody(this.runtimeConfig, this.themeName, "arrow")));
        return;
      case "clear":
      case "new":
        this.previousMessages = [];
        this.transcript = [];
        this.sessionEvents = [];
        this.sessionState = createEmptySessionState();
        this.entries = [];
        this.sessionMode = "build";
        this.applyComposerTheme();
        this.currentConversation = createConversationRecord(this.runtimeConfig, [], this.sessionMode);
        this.appendEntry(createEntry("status", "status", "Started a new conversation."));
        return;
      case "models":
        await this.openModelPicker();
        return;
      case "provider":
        this.openProviderPicker();
        return;
      case "theme":
      case "customize":
      case "settings":
        this.openThemePicker();
        return;
      case "approval-mode":
        this.openApprovalModePicker();
        return;
      case "history":
        await this.openHistoryPicker();
        return;
      case "export":
        this.exportConversation("html");
        return;
      case "export-md":
        this.exportConversation("markdown");
        return;
      case "memory":
      case "todos":
      case "context-window":
      case "init":
      case "fork":
      case "compact":
      case "plan":
        this.switchSessionMode("plan");
        return;
      case "build":
        this.switchSessionMode("build");
        return;
      case "layout":
      case "minimal":
        this.appendEntry(createEntry("status", "status", `/${command.name} is not implemented in the pi-tui shell yet.`));
        return;
    }
  }

  private async runPrompt(prompt: string): Promise<void> {
    this.setBusy(true, "thinking");
    this.abortController = new AbortController();
    const turnEvents: SessionEvent[] = [];
    const baseEvents = this.sessionEvents;

    try {
      const result = await runAgentLoop({
        systemPrompt: this.sessionMode === "plan" ? PLAN_SYSTEM_PROMPT : this.options.systemPrompt,
        initialUserPrompt: prompt,
        initialModelUserPrompt: this.sessionMode === "plan"
          ? buildPlanModeModelPrompt(prompt, { remindAboutPlanTags: false, remindAboutPlanRevision: false })
          : prompt,
        previousMessages: this.previousMessages,
        languageModel: createLanguageModel(this.runtimeConfig),
        toolRegistry: createToolRegistryForMode(this.options.toolRegistry, this.sessionMode),
        toolContext: this.createToolContext(this.abortController.signal),
        abortSignal: this.abortController.signal,
        onSessionEvent: (event) => {
          turnEvents.push(event);
          this.handleSessionEvent(event, baseEvents, turnEvents);
        },
        onTranscriptUpdate: (transcript) => {
          this.transcript = transcript;
          this.previousMessages = transcript;
        }
      });
      this.previousMessages = result.transcript;
      this.transcript = result.transcript;
      this.persistConversation();
    } catch (error) {
      this.appendEntry(createEntry("error", "error", error instanceof Error ? error.message : String(error)));
    } finally {
      this.abortController = undefined;
      this.setBusy(false, "thinking");
    }
  }

  private handleSessionEvent(event: SessionEvent, baseEvents: readonly SessionEvent[], turnEvents: readonly SessionEvent[]): void {
    this.sessionEvents = [...baseEvents, ...turnEvents].slice(-MAX_RETAINED_SESSION_EVENTS);
    this.sessionState = applySessionEvent(this.sessionState, event);
    this.entries = uiEntriesFromSessionState(this.sessionState);
    if (event.type === "tool.started") {
      this.setBusy(true, "tool");
      this.providerStatusText = event.toolCall.name;
    } else if (event.type === "provider.retry") {
      this.setBusy(true, "retrying");
      this.providerStatusText = `retry ${event.status.attempt}/${event.status.maxAttempts}`;
    } else if (event.type === "assistant.text.delta" || event.type === "tool.completed" || event.type === "tool.errored") {
      this.setBusy(true, "thinking");
      this.providerStatusText = undefined;
    } else {
      this.syncRender();
    }
  }

  private createToolContext(abortSignal: AbortSignal): ToolExecutionContext {
    return {
      ...this.toolContext,
      approvalMode: this.runtimeConfig.approvalMode,
      approvalAllowlist: this.runtimeConfig.approvalAllowlist,
      permissionRules: this.runtimeConfig.permissionRules,
      abortSignal,
      requestToolApproval: (request) => this.requestToolApproval(request),
      requestQuestionAnswers: (request) => this.requestQuestionAnswers(request)
    };
  }

  private requestToolApproval(request: ToolApprovalRequest): Promise<ToolApprovalDecision> {
    const description = `${request.toolName} wants ${request.scope} permission for ${request.pattern}`;
    return this.selectOverlay<ToolApprovalDecision>(
      `Approval required\n${description}`,
      [
        { value: "allow-once", label: "Allow once", description: "Run this tool call" },
        { value: "allow-always", label: "Allow always", description: "Allow this scope for the session" },
        { value: "deny", label: "Deny", description: "Reject this tool call" }
      ],
      "deny"
    );
  }

  private async requestQuestionAnswers(request: QuestionToolRequest): Promise<QuestionToolDecision> {
    const answers: QuestionAnswer[] = [];
    for (const question of request.questions) {
      const selected = await this.selectOverlay<string>(
        `${question.header}\n${question.question}`,
        [
          ...question.options.map((option) => ({ value: option.label, label: option.label, description: option.description })),
          { value: "__dismiss__", label: "Dismiss", description: "Dismiss this question" }
        ],
        "__dismiss__"
      );
      if (selected === "__dismiss__") {
        return { dismissed: true };
      }
      answers.push({ questionId: question.id, selectedOptionLabels: [selected], customText: "" });
    }
    return { dismissed: false, answers };
  }

  private async openModelPicker(): Promise<void> {
    const providers = this.runtimeConfig.providers.filter((provider) => provider.disabled !== true);
    if (providers.length === 0) {
      this.appendEntry(createEntry("error", "error", "No enabled providers are configured."));
      return;
    }
    this.setBusy(true, "thinking");
    try {
      const groups = await Promise.all(providers.map((provider) => listModelsForProvider(provider, this.runtimeConfig.providerId, true)));
      const items = groups.flatMap((group) => group.models.map((model) => ({
        value: `${group.providerId}\t${model.id}`,
        label: `${model.active ? "* " : ""}${group.providerName} · ${model.label ?? model.id}`,
        description: model.id
      })));
      if (items.length === 0) {
        this.appendEntry(createEntry("error", "error", "No models were returned by enabled providers."));
        return;
      }
      const selected = await this.selectOverlay("Select model", items, items[0]!.value);
      const [providerId, modelId] = selected.split("\t");
      if (providerId === undefined || modelId === undefined) return;
      this.selectProviderModel(providerId, modelId);
    } catch (error) {
      this.appendEntry(createEntry("error", "error", error instanceof Error ? error.message : String(error)));
    } finally {
      this.setBusy(false, "thinking");
    }
  }

  private openProviderPicker(): void {
    const items = this.runtimeConfig.providers.map((provider) => ({
      value: provider.id,
      label: `${provider.id === this.runtimeConfig.providerId ? "* " : ""}${provider.name}`,
      description: `${provider.kind}${provider.disabled === true ? " · disabled" : ""}`
    }));
    if (items.length === 0) {
      this.appendEntry(createEntry("error", "error", "No providers are configured. Run `recode setup` first."));
      return;
    }
    void this.selectOverlay("Select provider", items, this.runtimeConfig.providerId).then((providerId) => {
      const provider = this.runtimeConfig.providers.find((item) => item.id === providerId);
      const modelId = provider?.defaultModelId ?? provider?.models[0]?.id;
      if (provider === undefined || modelId === undefined || provider.disabled === true) {
        this.appendEntry(createEntry("error", "error", "Selected provider is unavailable."));
        return;
      }
      this.selectProviderModel(provider.id, modelId);
    });
  }

  private openThemePicker(): void {
    const themes = getAvailableThemes().map((theme) => ({
      value: theme.name,
      label: `${theme.name === this.themeName ? "* " : ""}${theme.label}`,
      description: theme.description
    }));
    void this.selectOverlay("Select theme", themes, this.themeName).then((themeName) => {
      if (!isThemeName(themeName)) return;
      const config = loadRecodeConfigFile(this.runtimeConfig.configPath);
      saveRecodeConfigFile(this.runtimeConfig.configPath, selectConfiguredTheme(config, themeName));
      this.themeName = themeName;
      this.theme = getTheme(themeName);
      this.applyComposerTheme();
      this.appendEntry(createEntry("status", "status", `Selected theme ${getThemeDefinition(themeName).label}`));
    });
  }

  private openApprovalModePicker(): void {
    const items: SelectItem[] = [
      { value: "approval", label: "Approval", description: "Ask before edits and shell commands" },
      { value: "auto-edits", label: "Auto-Edits", description: "Allow edits, ask before shell commands" },
      { value: "yolo", label: "YOLO", description: "Run tools without approval prompts" }
    ];
    void this.selectOverlay("Select approval mode", items, this.runtimeConfig.approvalMode).then((mode) => {
      const approvalMode = mode as ApprovalMode;
      const config = loadRecodeConfigFile(this.runtimeConfig.configPath);
      saveRecodeConfigFile(this.runtimeConfig.configPath, selectConfiguredApprovalMode(config, approvalMode));
      this.runtimeConfig = { ...this.runtimeConfig, approvalMode };
      this.appendEntry(createEntry("status", "status", `Selected approval mode ${approvalMode}`));
    });
  }

  private async openHistoryPicker(): Promise<void> {
    try {
      const items = listHistoryForWorkspace(loadHistoryIndex(this.historyRoot), this.runtimeConfig.workspaceRoot).map((item) => ({
        value: item.id,
        label: item.title,
        description: `${item.providerName} · ${item.model}`
      }));
      if (items.length === 0) {
        this.appendEntry(createEntry("status", "status", "No saved conversations for this workspace."));
        return;
      }
      const id = await this.selectOverlay("Open history", items, items[0]!.value);
      const conversation = loadConversation(this.historyRoot, id);
      if (conversation === undefined) {
        throw new Error("The selected conversation could not be loaded.");
      }
      markConversationAsCurrent(this.historyRoot, conversation.id);
      this.currentConversation = conversation;
      this.previousMessages = conversation.transcript;
      this.transcript = conversation.transcript;
      this.sessionEvents = conversation.sessionEvents ?? [];
      this.sessionState = createEmptySessionState();
      this.sessionMode = conversation.mode;
      this.applyComposerTheme();
      this.entries = this.sessionEvents.length > 0
        ? rehydrateEntriesFromSessionEvents(this.sessionEvents)
        : rehydrateEntriesFromTranscript(conversation.transcript);
      this.runtimeConfig = selectRuntimeProviderModel(this.runtimeConfig, conversation.providerId, conversation.model);
      this.syncRender();
    } catch (error) {
      this.appendEntry(createEntry("error", "error", error instanceof Error ? error.message : String(error)));
    }
  }

  private selectProviderModel(providerId: string, modelId: string): void {
    const config = loadRecodeConfigFile(this.runtimeConfig.configPath);
    saveRecodeConfigFile(this.runtimeConfig.configPath, selectConfiguredProviderModel(config, providerId, modelId));
    this.runtimeConfig = selectRuntimeProviderModel(this.runtimeConfig, providerId, modelId);
    this.persistConversation();
    this.appendEntry(createEntry("status", "status", `Selected ${this.runtimeConfig.providerName} · ${this.runtimeConfig.model}`));
  }

  private selectOverlay<T extends string>(title: string, items: readonly SelectItem[], fallback: T): Promise<T> {
    return new Promise((resolve) => {
      const list = new SelectList([...items], 12, this.createSelectTheme());
      list.setSelectedIndex(0);
      const popup = new BorderedPopup(title, list, this.theme);
      const handle = this.tui.showOverlay(popup, { anchor: "center", width: "80%", maxHeight: "60%", margin: 2 });
      list.onSelect = (item) => {
        handle.hide();
        this.tui.setFocus(this.editor);
        resolve(item.value as T);
      };
      list.onCancel = () => {
        handle.hide();
        this.tui.setFocus(this.editor);
        resolve(fallback);
      };
      handle.focus();
    });
  }

  private exportConversation(format: "html" | "markdown"): void {
    const conversation = this.persistConversation();
    if (conversation === undefined) {
      this.appendEntry(createEntry("error", "error", "There is no active conversation to export."));
      return;
    }
    const outputPath = format === "html"
      ? exportConversationToHtml({ workspaceRoot: this.runtimeConfig.workspaceRoot, conversation, themeName: this.themeName })
      : exportConversationToMarkdown({ workspaceRoot: this.runtimeConfig.workspaceRoot, conversation });
    this.appendEntry(createEntry("status", "status", `Exported conversation to ${outputPath}`));
  }

  private persistConversation(): SavedConversationRecord | undefined {
    if (this.transcript.length === 0) {
      return this.currentConversation;
    }
    const conversation = createConversationRecord(
      this.runtimeConfig,
      this.transcript,
      this.sessionMode,
      this.currentConversation === undefined ? undefined : { id: this.currentConversation.id, createdAt: this.currentConversation.createdAt },
      [],
      [],
      this.sessionEvents
    );
    saveConversation(this.historyRoot, conversation, true);
    this.currentConversation = conversation;
    return conversation;
  }

  private appendEntry(entry: UiEntry): void {
    this.entries = [...this.entries, entry];
    this.syncRender();
  }

  private setBusy(value: boolean, phase: "thinking" | "tool" | "retrying"): void {
    this.busy = value;
    this.busyPhase = phase;
    if (value) {
      this.loader.start();
      this.editor.disableSubmit = true;
    } else {
      this.loader.stop();
      this.editor.disableSubmit = false;
      this.providerStatusText = undefined;
    }
    this.syncRender();
  }

  private switchSessionMode(nextMode: SessionMode): void {
    if (this.sessionMode === nextMode) {
      this.appendEntry(createEntry("status", "status", `${getSessionModeLabel(nextMode)} mode is already active.`));
      return;
    }

    this.sessionMode = nextMode;
    this.applyComposerTheme();
    this.persistConversation();
    this.appendEntry(createEntry(
      "status",
      "status",
      nextMode === "plan"
        ? "Switched to PLAN mode. Recode will plan without editing files."
        : "Switched to BUILD mode. Recode can implement changes."
    ));
  }

  private applyComposerTheme(): void {
    this.editor.borderColor = (text) => chalk.hex(this.getComposerBorderColor())(text);
  }

  private getComposerBorderColor(): string {
    return this.sessionMode === "plan" ? this.theme.warning : this.theme.promptBorder;
  }

  private busyLabel(): string {
    if (this.providerStatusText !== undefined) {
      return this.providerStatusText;
    }
    switch (this.busyPhase) {
      case "tool":
        return "Running tool...";
      case "retrying":
        return "Retrying provider...";
      case "thinking":
        return "";
    }
  }

  private abortCurrentRun(): void {
    this.abortController?.abort();
  }

  private handleCtrlC(): void {
    if (this.busy) {
      this.abortCurrentRun();
      this.appendEntry(createEntry("status", "status", "Aborted current run. Press Ctrl+C again to exit."));
      return;
    }
    if (this.ctrlCArmed) {
      this.exit();
      return;
    }
    this.ctrlCArmed = true;
    this.appendEntry(createEntry("status", "status", "Press Ctrl+C again to exit."));
    if (this.ctrlCTimer !== undefined) clearTimeout(this.ctrlCTimer);
    this.ctrlCTimer = setTimeout(() => {
      this.ctrlCArmed = false;
      this.ctrlCTimer = undefined;
    }, 1800);
  }

  private exit(): void {
    this.persistConversation();
    this.tui.stop();
    this.resolveExit();
  }

  private createEditorTheme(): EditorTheme {
    return {
      borderColor: (text) => chalk.hex(this.getComposerBorderColor())(text),
      selectList: this.createSelectTheme()
    };
  }

  private createSelectTheme(): SelectListTheme {
    return {
      selectedPrefix: (text) => chalk.hex(this.theme.active)(text),
      selectedText: (text) => chalk.hex(this.theme.inverseText).bgHex(this.theme.active)(text),
      description: (text) => chalk.hex(this.theme.subtle)(text),
      scrollInfo: (text) => chalk.hex(this.theme.hintText)(text),
      noMatch: (text) => chalk.hex(this.theme.error)(text)
    };
  }

  private createAutocompleteProvider() {
    const commands: SlashCommand[] = getBuiltinCommands().map((command) => ({
      name: command.name,
      description: command.description
    }));
    const provider = new CombinedAutocompleteProvider(commands, this.runtimeConfig.workspaceRoot);
    return {
      triggerCharacters: ["/", "@", "#"],
      getSuggestions: provider.getSuggestions.bind(provider),
      applyCompletion: provider.applyCompletion.bind(provider),
      shouldTriggerFileCompletion: provider.shouldTriggerFileCompletion.bind(provider)
    };
  }
}

class BorderedPopup implements Component {
  constructor(
    private readonly title: string,
    private readonly child: Component,
    private readonly theme: ThemeColors
  ) {}

  handleInput(data: string): void {
    this.child.handleInput?.(data);
  }

  invalidate(): void {
    this.child.invalidate();
  }

  render(width: number): string[] {
    const innerWidth = Math.max(8, width - 4);
    const content = this.child.render(innerWidth).map((line) => truncateToWidth(line, innerWidth, ""));
    const top = this.renderTopBorder(width);
    const bottom = chalk.hex(this.theme.divider)(`╰${"─".repeat(Math.max(0, width - 2))}╯`);
    const titleLines = this.renderTitleLines(innerWidth);

    return [
      top,
      ...titleLines.map((line) => this.renderContentLine(chalk.hex(this.theme.brand).bold(line), innerWidth)),
      ...(titleLines.length === 0 ? [] : [this.renderContentLine(chalk.hex(this.theme.divider)("─".repeat(innerWidth)), innerWidth)]),
      ...content.map((line) => this.renderContentLine(line, innerWidth)),
      bottom
    ];
  }

  private renderTopBorder(width: number): string {
    return chalk.hex(this.theme.divider)(`╭${"─".repeat(Math.max(0, width - 2))}╮`);
  }

  private renderTitleLines(innerWidth: number): string[] {
    return this.title
      .split("\n")
      .flatMap((line) => wrapPlainText(line.trim(), innerWidth))
      .filter((line) => line !== "");
  }

  private renderContentLine(line: string, innerWidth: number): string {
    const padding = " ".repeat(Math.max(0, innerWidth - visibleWidth(line)));
    return `${chalk.hex(this.theme.divider)("│")} ${line}${padding} ${chalk.hex(this.theme.divider)("│")}`;
  }
}

function readConfiguredTheme(configPath: string): ThemeName {
  const value = loadRecodeConfigFile(configPath).themeName;
  return value ?? DEFAULT_THEME_NAME;
}

function wrapPlainText(value: string, width: number): string[] {
  const words = value.split(/\s+/).filter((word) => word !== "");
  if (words.length === 0) {
    return [];
  }

  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (visibleWidth(word) > width) {
      if (current !== "") {
        lines.push(current);
        current = "";
      }
      lines.push(...splitLongWord(word, width));
      continue;
    }

    const next = current === "" ? word : `${current} ${word}`;
    if (visibleWidth(next) <= width) {
      current = next;
      continue;
    }

    if (current !== "") {
      lines.push(current);
    }
    current = word;
  }

  if (current !== "") {
    lines.push(current);
  }

  return lines;
}

function splitLongWord(value: string, width: number): string[] {
  const safeWidth = Math.max(1, width);
  const result: string[] = [];
  let remaining = value;
  while (remaining !== "") {
    const chunk = truncateToWidth(remaining, safeWidth, "");
    result.push(chunk);
    remaining = remaining.slice(chunk.length);
  }
  return result;
}
