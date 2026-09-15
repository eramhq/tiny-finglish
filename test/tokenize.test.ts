/**
 * Protected-span regressions are, per the plan's risk register, the fastest way
 * to lose users. These tests assert byte-identity, not merely "close enough".
 */
import { describe, expect, it } from "vitest";
import { tokenize } from "../src/tokenize.ts";

const kinds = (input: string) =>
  tokenize(input).map((t) => `${t.kind}${t.reason ? `:${t.reason}` : ""}`);
const protectedText = (input: string) =>
  tokenize(input).filter((t) => t.kind === "protected").map((t) => t.text);

describe("tokenize", () => {
  it("is lossless: concatenating tokens reproduces the input exactly", () => {
    for (const input of [
      "salam, man emrooz miram Muscat",
      "https://example.ir/a?b=1#c va ali@example.com",
      "  leading and trailing   ",
      "emoji \u{1F600}\u{1F1EE}\u{1F1F7} and سلام",
      "`code` @user #tag 3.5 API_KEY",
      "",
      "\n\n\t",
    ]) {
      expect(tokenize(input).map((t) => t.text).join("")).toBe(input);
    }
  });

  it("emits offsets that index back into the source", () => {
    const input = "salam, man emrooz";
    for (const token of tokenize(input)) {
      expect(input.slice(token.start, token.end)).toBe(token.text);
    }
  });

  const protectedCases: Array<[string, string]> = [
    ["https://example.ir/salam", "url"],
    ["www.example.com", "url"],
    ["example.com/a/b", "url"],
    ["ali@example.com", "email"],
    ["@navid", "mention"],
    ["#tehran", "hashtag"],
    ["#تهران", "hashtag"],
    ["021-12345678", "number"],
    ["3.5", "number"],
    ["100%", "number"],
    ["`npm install`", "code"],
    ["API_KEY", "code"],
    ["userName", "code"],
    ["\u{1F600}", "emoji"],
    ["سلام", "non-latin"],
  ];

  it("protects each hard class byte-identically", () => {
    for (const [input, reason] of protectedCases) {
      const tokens = tokenize(input);
      expect(tokens, `${input} should be one token`).toHaveLength(1);
      expect(tokens[0]!.kind, input).toBe("protected");
      expect(tokens[0]!.reason, input).toBe(reason);
      expect(tokens[0]!.text, input).toBe(input);
    }
  });

  it("protects a URL that contains an @, rather than reading it as an email", () => {
    expect(protectedText("https://example.com/@user")).toEqual(["https://example.com/@user"]);
  });

  it("keeps a capitalized proper noun but converts sentence-initial capitals", () => {
    expect(kinds("man emrooz miram Muscat").at(-1)).toBe("protected:english");
    expect(kinds("Salam donya")[0]).toBe("word");
  });

  it("converts Persian place names even when capitalized", () => {
    // Without the homograph override, the proper-noun heuristic would preserve
    // these as English and the user would never get تهران.
    expect(kinds("man be Tehran raft")).not.toContain("protected:english");
    expect(kinds("Esfahan ziba ast")[0]).toBe("word");
  });

  it("does not mistake Finglish for English", () => {
    // Each of these is a real English word and a far more likely Finglish one.
    for (const word of ["man", "to", "in", "bad", "sad", "dust", "name", "chap", "par", "are"]) {
      expect(tokenize(word)[0]!.kind, `${word} should convert`).toBe("word");
    }
  });

  it("protects English words that Finglish cannot produce", () => {
    for (const word of ["the", "through", "meeting", "settings", "whatever"]) {
      expect(tokenize(word)[0]!.kind, `${word} should be protected`).toBe("protected");
    }
  });

  it("honours protect and forceConvert overrides", () => {
    expect(tokenize("salam", { protect: ["salam"] })[0]!.kind).toBe("protected");
    expect(tokenize("Muscat", { forceConvert: ["muscat"] })[0]!.kind).toBe("word");
    // forceConvert beats a hard pattern too.
    expect(tokenize("API_KEY", { forceConvert: ["api_key"] })[0]!.kind).not.toBe("protected");
  });

  it("always advances, even on unmatched code points", () => {
    const odd = String.fromCharCode(0) + "�";
    expect(() => tokenize(odd)).not.toThrow();
    expect(tokenize(odd).map((t) => t.text).join("")).toBe(odd);
  });
});
