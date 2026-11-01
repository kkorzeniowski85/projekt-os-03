import { describe, expect, it } from "vitest";

import { isBritish, isNaturalVoice, voiceScore } from "./speech";

const glos = (name: string, lang = "en-GB", localService = true) => ({ name, lang, localService });

describe("voiceScore", () => {
  it("stawia glosy naturalne przed systemowymi", () => {
    const lista = [
      glos("Microsoft Hazel - English (United Kingdom)"),
      glos("Google UK English Female", "en-GB", false),
      glos("Microsoft Sonia Online (Natural) - English (United Kingdom)", "en-GB", false),
    ].sort((a, b) => voiceScore(b) - voiceScore(a));
    expect(lista.map((g) => g.name)).toEqual([
      "Microsoft Sonia Online (Natural) - English (United Kingdom)",
      "Google UK English Female",
      "Microsoft Hazel - English (United Kingdom)",
    ]);
  });

  it("rozpoznaje glos naturalny", () => {
    expect(isNaturalVoice(glos("Google UK English Male", "en-GB", false))).toBe(true);
    expect(isNaturalVoice(glos("Microsoft George - English (United Kingdom)"))).toBe(false);
  });

  it("uznaje en_GB i en-GB za brytyjski, en-US nie", () => {
    expect(isBritish({ lang: "en_GB" })).toBe(true);
    expect(isBritish({ lang: "en-GB" })).toBe(true);
    expect(isBritish({ lang: "en-US" })).toBe(false);
  });
});
