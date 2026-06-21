/**
 * Color theme system for the Recode TUI.
 *
 * Inspired by cc-haha's `theme.ts`, adapted to Recode's brand palette. All
 * colors use hex values and are directly compatible with OpenTUI `fg` and `bg`
 * props.
 *
 * @author dev
 */

/** Theme color table. */
export interface ThemeColors {
  /** Primary text color. */
  readonly text: string;
  /** Inverse text color. */
  readonly inverseText: string;
  /** Primary brand color. */
  readonly brand: string;
  /** Bright brand highlight color. */
  readonly brandShimmer: string;
  /** Inactive text color. */
  readonly inactive: string;
  /** Subtle text color. */
  readonly subtle: string;
  /** Success color. */
  readonly success: string;
  /** Error color. */
  readonly error: string;
  /** Warning color. */
  readonly warning: string;
  /** Suggestion or hint color. */
  readonly suggestion: string;
  /** User message background. */
  readonly userMessageBackground: string;
  /** User message hover background. */
  readonly userMessageBackgroundHover: string;
  /** Message action background in selected state. */
  readonly messageActionsBackground: string;
  /** Prompt border color. */
  readonly promptBorder: string;
  /** Border color used for bash and tool blocks. */
  readonly bashBorder: string;
  /** Bash message background color. */
  readonly bashMessageBackgroundColor: string;
  /** Text selection background. */
  readonly selectionBg: string;
  /** Status bar text color. */
  readonly statusText: string;
  /** Hint text color. */
  readonly hintText: string;
  /** Divider color. */
  readonly divider: string;
  /** Active indicator color. */
  readonly active: string;
  /** User label color. */
  readonly user: string;
  /** Assistant label color. */
  readonly assistantLabel: string;
  /** Assistant body text color. */
  readonly assistantBody: string;
  /** Tool and secondary information color. */
  readonly tool: string;
  /** Diff added color. */
  readonly diffAdded: string;
  /** Diff removed color. */
  readonly diffRemoved: string;
}

/** Named theme identifiers. */
export type ThemeName = "senren-dusk" | "matcha-night" | "midnight-ink" | "amber-terminal" | "sakura-bloom" | "monochrome" | "1998" | "ocean-depth" | "neon-noir" | "paper";

/** Named tool marker identifiers. */
export type ToolMarkerName = "arrow" | "hook" | "fancy" | "triangle" | "minimal" | "stylized";

/** Layout density mode. */
export type LayoutMode = "compact" | "comfortable";

/** Default layout mode. */
export const DEFAULT_LAYOUT_MODE: LayoutMode = "comfortable";

/** Default tool marker. */
export const DEFAULT_TOOL_MARKER_NAME: ToolMarkerName = "arrow";

/** One selectable theme definition. */
export interface ThemeDefinition {
  readonly name: ThemeName;
  readonly label: string;
  readonly description: string;
  readonly colors: ThemeColors;
  readonly promptMarker: string;
}

/** One selectable tool marker definition. */
export interface ToolMarkerDefinition {
  readonly name: ToolMarkerName;
  readonly label: string;
  readonly symbol: string;
}

/** Default theme name. */
export const DEFAULT_THEME_NAME: ThemeName = "senren-dusk";

/** Senren-inspired pink dusk theme. */
export const SENREN_DUSK_THEME: ThemeColors = {
  text: "#fff6f0",
  inverseText: "#000000",
  brand: "#ff8fb4",
  brandShimmer: "#ffd2df",
  inactive: "#f4e6df",
  subtle: "#d8bbb0",
  success: "#7fb069",
  error: "#ff9aa6",
  warning: "#ffc27a",
  suggestion: "#f6b37d",
  userMessageBackground: "#2b1717",
  userMessageBackgroundHover: "#382020",
  messageActionsBackground: "#352626",
  promptBorder: "#b89a9644",
  bashBorder: "#ff8bb8",
  bashMessageBackgroundColor: "#241313",
  selectionBg: "#6a353e",
  statusText: "#ffe5cb",
  hintText: "#d4bdb6",
  divider: "#c9a09c",
  active: "#ff8fb4",
  user: "#ffd4a0",
  assistantLabel: "#ffd8e6",
  assistantBody: "#fff7f2",
  tool: "#e8c4a4",
  diffAdded: "#356b3d",
  diffRemoved: "#8f3d4d",
};

/** Cool green night theme. */
export const MATCHA_NIGHT_THEME: ThemeColors = {
  text: "#eef6ea",
  inverseText: "#08110b",
  brand: "#8fd07e",
  brandShimmer: "#d9f3c7",
  inactive: "#c6d4c1",
  subtle: "#9fb39d",
  success: "#7ec96e",
  error: "#f08f9a",
  warning: "#f0c06d",
  suggestion: "#b6d989",
  userMessageBackground: "#142019",
  userMessageBackgroundHover: "#1b2a20",
  messageActionsBackground: "#233127",
  promptBorder: "#8fb48655",
  bashBorder: "#8fd07e",
  bashMessageBackgroundColor: "#121a14",
  selectionBg: "#36533b",
  statusText: "#d8efb8",
  hintText: "#a9bca7",
  divider: "#86a88a",
  active: "#8fd07e",
  user: "#f2d084",
  assistantLabel: "#d9f3c7",
  assistantBody: "#f4fbf0",
  tool: "#c4df9b",
  diffAdded: "#274930",
  diffRemoved: "#5b2d37",
};

/** Deep blue indigo dark theme. */
export const MIDNIGHT_INK_THEME: ThemeColors = {
  text: "#d0d8e8",
  inverseText: "#0a0e17",
  brand: "#58a6ff",
  brandShimmer: "#a0cdff",
  inactive: "#8b9dc3",
  subtle: "#6b7d9e",
  success: "#56d364",
  error: "#f85149",
  warning: "#d29922",
  suggestion: "#79c0ff",
  userMessageBackground: "#0d1526",
  userMessageBackgroundHover: "#131d30",
  messageActionsBackground: "#182336",
  promptBorder: "#30415a55",
  bashBorder: "#58a6ff",
  bashMessageBackgroundColor: "#0b1220",
  selectionBg: "#264f78",
  statusText: "#c0d8f0",
  hintText: "#6b7d9e",
  divider: "#30415a",
  active: "#58a6ff",
  user: "#d2a8ff",
  assistantLabel: "#a0cdff",
  assistantBody: "#e0e8f0",
  tool: "#79c0ff",
  diffAdded: "#1b4332",
  diffRemoved: "#5c2030",
};

/** Retro amber-on-black CRT theme. */
export const AMBER_TERMINAL_THEME: ThemeColors = {
  text: "#ffcc66",
  inverseText: "#1a1200",
  brand: "#ffb000",
  brandShimmer: "#ffd866",
  inactive: "#cc9933",
  subtle: "#a67c00",
  success: "#66cc33",
  error: "#ff6644",
  warning: "#ffaa00",
  suggestion: "#e6a800",
  userMessageBackground: "#1a1400",
  userMessageBackgroundHover: "#221a00",
  messageActionsBackground: "#2a2000",
  promptBorder: "#7a600044",
  bashBorder: "#ffb000",
  bashMessageBackgroundColor: "#141000",
  selectionBg: "#4a3800",
  statusText: "#ffe080",
  hintText: "#a68a40",
  divider: "#7a6020",
  active: "#ffb000",
  user: "#ffe0a0",
  assistantLabel: "#ffd866",
  assistantBody: "#ffdd88",
  tool: "#e6c060",
  diffAdded: "#2a4010",
  diffRemoved: "#5c2010",
};

/** Bright vivid sakura pink theme. */
export const SAKURA_BLOOM_THEME: ThemeColors = {
  text: "#fff0f5",
  inverseText: "#1a0010",
  brand: "#ff69b4",
  brandShimmer: "#ffb6c1",
  inactive: "#d4a0b0",
  subtle: "#c08090",
  success: "#66bb6a",
  error: "#ff5252",
  warning: "#ffab40",
  suggestion: "#ff80ab",
  userMessageBackground: "#2a0f1a",
  userMessageBackgroundHover: "#351520",
  messageActionsBackground: "#3a1a26",
  promptBorder: "#a0607055",
  bashBorder: "#ff69b4",
  bashMessageBackgroundColor: "#200a14",
  selectionBg: "#6a2040",
  statusText: "#ffd0e0",
  hintText: "#c0909a",
  divider: "#b07080",
  active: "#ff69b4",
  user: "#ffd700",
  assistantLabel: "#ffb6c1",
  assistantBody: "#fff5f8",
  tool: "#f0a0c0",
  diffAdded: "#1a4030",
  diffRemoved: "#5c1a30",
};

/** High-contrast monochrome dark theme. */
export const MONOCHROME_THEME: ThemeColors = {
  text: "#f5f5f5",
  inverseText: "#101010",
  brand: "#ffffff",
  brandShimmer: "#d9d9d9",
  inactive: "#a6a6a6",
  subtle: "#8c8c8c",
  success: "#cfcfcf",
  error: "#e0e0e0",
  warning: "#d4d4d4",
  suggestion: "#bfbfbf",
  userMessageBackground: "#171717",
  userMessageBackgroundHover: "#202020",
  messageActionsBackground: "#262626",
  promptBorder: "#8c8c8c55",
  bashBorder: "#ffffff",
  bashMessageBackgroundColor: "#141414",
  selectionBg: "#4d4d4d",
  statusText: "#f0f0f0",
  hintText: "#b0b0b0",
  divider: "#6e6e6e",
  active: "#ffffff",
  user: "#f5f5f5",
  assistantLabel: "#e6e6e6",
  assistantBody: "#fafafa",
  tool: "#d0d0d0",
  diffAdded: "#2d2d2d",
  diffRemoved: "#3a3a3a",
};

/** Professional charcoal theme with restrained sunset accents. */
export const SUNSET_CHARCOAL_THEME: ThemeColors = {
  text: "#D6D3D3",
  inverseText: "#101012",
  brand: "#5F9E9E",
  brandShimmer: "#86C5C5",
  inactive: "#7C797B",
  subtle: "#5E5B5D",
  success: "#5F9E9E",
  error: "#E5484D",
  warning: "#D98752",
  suggestion: "#D98752",
  userMessageBackground: "#141416",
  userMessageBackgroundHover: "#19191B",
  messageActionsBackground: "#1E1D20",
  promptBorder: "#2B4548",
  bashBorder: "#5F9E9E",
  bashMessageBackgroundColor: "#101112",
  selectionBg: "#3C302A",
  statusText: "#B8B4B5",
  hintText: "#9B989A",
  divider: "#28262A",
  active: "#5F9E9E",
  user: "#D6D3D3",
  assistantLabel: "#86C5C5",
  assistantBody: "#B8B5B6",
  tool: "#5F9E9E",
  diffAdded: "#1D3737",
  diffRemoved: "#3B2022",
};

/** Deep teal and navy ocean theme. */
export const OCEAN_DEPTH_THEME: ThemeColors = {
  text: "#d0ece8",
  inverseText: "#04121a",
  brand: "#00c4b4",
  brandShimmer: "#7fecdf",
  inactive: "#8ab8b4",
  subtle: "#6a9a96",
  success: "#3dd68c",
  error: "#ff6b6b",
  warning: "#ffcc5c",
  suggestion: "#00d4c8",
  userMessageBackground: "#062030",
  userMessageBackgroundHover: "#0b2c3e",
  messageActionsBackground: "#0e3448",
  promptBorder: "#1a5a6a55",
  bashBorder: "#00c4b4",
  bashMessageBackgroundColor: "#041820",
  selectionBg: "#1a4a5a",
  statusText: "#b0dcd8",
  hintText: "#6a9a96",
  divider: "#1a5060",
  active: "#00c4b4",
  user: "#ffe599",
  assistantLabel: "#7fecdf",
  assistantBody: "#e0f4f2",
  tool: "#40c4b8",
  diffAdded: "#0e3d2e",
  diffRemoved: "#3d1a1a",
};

/** Black background with electric purple and cyan accents. */
export const NEON_NOIR_THEME: ThemeColors = {
  text: "#e8e0ff",
  inverseText: "#08000f",
  brand: "#bf5fff",
  brandShimmer: "#df9fff",
  inactive: "#9970cc",
  subtle: "#7050aa",
  success: "#00ffcc",
  error: "#ff3366",
  warning: "#ffcc00",
  suggestion: "#00e5ff",
  userMessageBackground: "#0e0020",
  userMessageBackgroundHover: "#160030",
  messageActionsBackground: "#1c003a",
  promptBorder: "#6030a055",
  bashBorder: "#bf5fff",
  bashMessageBackgroundColor: "#090015",
  selectionBg: "#4a1080",
  statusText: "#d0b0ff",
  hintText: "#8060b0",
  divider: "#3a1060",
  active: "#bf5fff",
  user: "#00ffcc",
  assistantLabel: "#df9fff",
  assistantBody: "#f0e8ff",
  tool: "#00e5ff",
  diffAdded: "#003326",
  diffRemoved: "#330014",
};

/** Dark parchment theme — warm cream text with crimson accents on a black background. */
export const PAPER_THEME: ThemeColors = {
  text: "#ede0c4",
  inverseText: "#1c1209",
  brand: "#c0392b",
  brandShimmer: "#e8604a",
  inactive: "#a89070",
  subtle: "#8a7060",
  success: "#6aaa3a",
  error: "#e8604a",
  warning: "#c8902a",
  suggestion: "#c0392b",
  userMessageBackground: "#1a1510",
  userMessageBackgroundHover: "#221c14",
  messageActionsBackground: "#2a221a",
  promptBorder: "#5a4a3055",
  bashBorder: "#c0392b",
  bashMessageBackgroundColor: "#14100a",
  selectionBg: "#4a3020",
  statusText: "#d8c8a8",
  hintText: "#8a7860",
  divider: "#4a3a28",
  active: "#c0392b",
  user: "#ede0c4",
  assistantLabel: "#e8604a",
  assistantBody: "#ddd0b8",
  tool: "#b89868",
  diffAdded: "#1c3010",
  diffRemoved: "#3a1010",
};

const THEMES: readonly ThemeDefinition[] = [
  {
    name: "senren-dusk",
    label: "Senren Dusk",
    description: "Warm sakura pinks and soft lantern contrast.",
    colors: SENREN_DUSK_THEME,
    promptMarker: "◈"
  },
  {
    name: "matcha-night",
    label: "Matcha Night",
    description: "Quiet green night palette with softer contrast.",
    colors: MATCHA_NIGHT_THEME,
    promptMarker: "λ"
  },
  {
    name: "midnight-ink",
    label: "Midnight Ink",
    description: "Deep blue indigo dark palette for late-night coding.",
    colors: MIDNIGHT_INK_THEME,
    promptMarker: "⌘"
  },
  {
    name: "amber-terminal",
    label: "Amber Terminal",
    description: "Retro amber-on-black CRT nostalgia.",
    colors: AMBER_TERMINAL_THEME,
    promptMarker: "▸"
  },
  {
    name: "sakura-bloom",
    label: "Sakura Bloom",
    description: "Vivid sakura pink with warm golden accents.",
    colors: SAKURA_BLOOM_THEME,
    promptMarker: "✿"
  },
  {
    name: "monochrome",
    label: "Monochrome",
    description: "High-contrast grayscale theme with no color accents.",
    colors: MONOCHROME_THEME,
    promptMarker: "•"
  },
  {
    name: "1998",
    label: "1998",
    description: "Professional charcoal palette with muted sunset accents.",
    colors: SUNSET_CHARCOAL_THEME,
    promptMarker: "◆"
  },
  {
    name: "ocean-depth",
    label: "Ocean Depth",
    description: "Deep teal and navy blues with aqua highlights.",
    colors: OCEAN_DEPTH_THEME,
    promptMarker: "◈"
  },
  {
    name: "neon-noir",
    label: "Neon Noir",
    description: "Black background with electric purple and cyan accents.",
    colors: NEON_NOIR_THEME,
    promptMarker: "⟡"
  },
  {
    name: "paper",
    label: "Paper",
    description: "Warm cream paper with ink-black text and crimson accents.",
    colors: PAPER_THEME,
    promptMarker: "›"
  }
] as const;

const TOOL_MARKERS: readonly ToolMarkerDefinition[] = [
  { name: "arrow", label: "Arrow", symbol: "→" },
  { name: "hook", label: "Hook", symbol: "↳" },
  { name: "fancy", label: "Fancy", symbol: "➜" },
  { name: "triangle", label: "Triangle", symbol: "▸" },
  { name: "minimal", label: "Minimal", symbol: "›" },
  { name: "stylized", label: "Stylized", symbol: "⇢" }
] as const;

/**
 * Return all available themes.
 *
 * @returns Theme definitions
 */
export function getAvailableThemes(): readonly ThemeDefinition[] {
  return THEMES;
}

/**
 * Return all available tool markers.
 *
 * @returns Tool marker definitions
 */
export function getAvailableToolMarkers(): readonly ToolMarkerDefinition[] {
  return TOOL_MARKERS;
}

/**
 * Check whether a theme name is valid.
 *
 * @param value Candidate theme name
 * @returns Whether the theme exists
 */
export function isThemeName(value: string): value is ThemeName {
  return THEMES.some((theme) => theme.name === value);
}

/**
 * Check whether a tool marker name is valid.
 *
 * @param value Candidate tool marker name
 * @returns Whether the marker exists
 */
export function isToolMarkerName(value: string): value is ToolMarkerName {
  return TOOL_MARKERS.some((marker) => marker.name === value);
}

/**
 * Resolve a theme definition by name.
 *
 * @param name Theme name
 * @returns Theme definition
 */
export function getThemeDefinition(name: ThemeName): ThemeDefinition {
  return THEMES.find((theme) => theme.name === name) ?? THEMES[0]!;
}

/**
 * Resolve a tool marker definition by name.
 *
 * @param name Tool marker name
 * @returns Tool marker definition
 */
export function getToolMarkerDefinition(name: ToolMarkerName): ToolMarkerDefinition {
  return TOOL_MARKERS.find((marker) => marker.name === name) ?? TOOL_MARKERS[0]!;
}

/**
 * Get the theme color table for a named theme.
 *
 * @param name Theme name
 * @returns Theme color table
 */
export function getTheme(name: ThemeName = DEFAULT_THEME_NAME): ThemeColors {
  return getThemeDefinition(name).colors;
}

/**
 * Check whether a layout mode value is valid.
 *
 * @param value Candidate layout mode
 * @returns Whether the value is a valid layout mode
 */
export function isLayoutMode(value: string): value is LayoutMode {
  return value === "compact" || value === "comfortable";
}
