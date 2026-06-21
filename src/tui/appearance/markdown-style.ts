/**
 * Markdown syntax styling based on the Senren-inspired theme palette.
 *
 * Provides a pi-tui Markdown theme, covering inline
 * elements such as bold text, italics, code, and links.
 *
 * @author dev
 */

import chalk from "chalk";
import type { MarkdownTheme } from "../pi-tui/index.ts";
import type { ThemeColors } from "./theme.ts";

/**
 * Create Markdown syntax styling from the current theme.
 *
 * @param theme Current theme color table
 * @returns Configured Markdown theme
 */
export function createMarkdownSyntaxStyle(theme: ThemeColors): MarkdownTheme {
  return {
    heading: (text) => chalk.hex(theme.brand).bold(text),
    link: (text) => chalk.hex(theme.suggestion)(text),
    linkUrl: (text) => chalk.hex(theme.suggestion).underline(text),
    code: (text) => chalk.hex(theme.tool)(text),
    codeBlock: (text) => chalk.hex(theme.assistantBody)(text),
    codeBlockBorder: (text) => chalk.hex(theme.bashBorder)(text),
    quote: (text) => chalk.hex(theme.subtle)(text),
    quoteBorder: (text) => chalk.hex(theme.divider)(text),
    hr: (text) => chalk.hex(theme.divider)(text),
    listBullet: (text) => chalk.hex(theme.brand)(text),
    bold: (text) => chalk.hex(theme.brandShimmer).bold(text),
    italic: (text) => chalk.hex(theme.subtle).italic(text),
    strikethrough: (text) => chalk.hex(theme.inactive).strikethrough(text),
    underline: (text) => chalk.hex(theme.suggestion).underline(text)
  };
}
