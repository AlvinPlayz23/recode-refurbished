/**
 * Tests for shared selector-navigation helpers.
 */

import { describe, expect, it } from "bun:test";
import {
  getHistoryPickerScrollOffset,
  getHistoryPickerVisibleCount
} from "./selector-navigation.ts";

describe("selector navigation helpers", () => {
  it("computes history picker scroll offsets from compact row height", () => {
    expect(getHistoryPickerScrollOffset(-1)).toBe(0);
    expect(getHistoryPickerScrollOffset(0)).toBe(0);
    expect(getHistoryPickerScrollOffset(1)).toBe(2);
    expect(getHistoryPickerScrollOffset(3)).toBe(6);
  });

  it("uses the compact history row height for visible count math", () => {
    expect(getHistoryPickerVisibleCount(26)).toBe(4);
    expect(getHistoryPickerVisibleCount(80)).toBe(8);
  });
});
