/**
 * Tests for prompt submission helpers.
 */

import { describe, expect, it } from "bun:test";
import { expandDraftPastes } from "./prompt-submission-controller.ts";

describe("prompt submission helpers", () => {
  it("expands compact paste placeholders before submission", () => {
    expect(expandDraftPastes("before {Paste 2 lines #1} after", [
      {
        token: "{Paste 2 lines #1}",
        text: "one\ntwo"
      }
    ])).toBe("before one\ntwo after");
  });

  it("expands repeated placeholders", () => {
    expect(expandDraftPastes("{Paste 1 lines #1} + {Paste 1 lines #1}", [
      {
        token: "{Paste 1 lines #1}",
        text: "same"
      }
    ])).toBe("same + same");
  });
});
