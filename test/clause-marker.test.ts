/**
 * The clause marker: a model trained with `<eos>` after clause-final words
 * (`train.py --surgery-from`) gets it at runtime too, and only then.
 *
 * What is pinned is the plumbing, not accuracy: which words the marker reaches,
 * that weights without the `clauseMarker` header flag never see it, and that
 * the two positions of one word are separate memo entries only when it matters.
 * The shipped weights are used with the flag forced on; their `<eos>` row is
 * untrained, which is irrelevant to where the marker is sent.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { Transliterator } from "../src/index.ts";
import { Transducer } from "../src/runtime.ts";
import { loadModel } from "../scripts/_load.ts";

const model = loadModel();

/** Each forward pass's ids, as the word it encodes plus a trailing `<eos>` marker if sent. */
function calls(transliterator: Transliterator, input: string): string[] {
  const spy = vi.spyOn(Transducer.prototype, "forward");
  transliterator.transliterate(input);
  const vocab = model!.vocab.input;
  const seen = spy.mock.calls.map(([ids]) => Array.from(ids, (id) => vocab[id]!).join(""));
  spy.mockRestore();
  return seen;
}

describe.skipIf(!model)("the clause marker", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is sent after a clause-final word only, for weights that ask for it", () => {
    // A fresh engine per input, so the memo cannot hide a pass.
    const marked = () => new Transliterator({ model: { ...model!, clauseMarker: true } });
    expect(calls(marked(), "ketabe man ketabe")).toEqual(["ketabe", "man", "ketabe<eos>"]);
    expect(calls(marked(), "havaa khoobe, vali sard")).toEqual(["havaa", "khoobe<eos>", "vali", "sard<eos>"]);
    expect(calls(marked(), "khoobe ?")).toEqual(["khoobe<eos>"]);
  });

  it("is not sent before a copy span, which is still a following word", () => {
    const marked = new Transliterator({ model: { ...model!, clauseMarker: true } });
    expect(calls(marked, "ino bebin https://example.com")).toContain("bebin");
  });

  it("is never sent to weights without the header flag, and one memo entry serves both positions", () => {
    const { clauseMarker: _, ...plain } = model!;
    const unmarked = new Transliterator({ model: plain });
    expect(calls(unmarked, "ketabe man ketabe")).toEqual(["ketabe", "man"]);
  });

  it("keeps the two positions apart in the memo when it is sent", () => {
    const marked = new Transliterator({ model: { ...model!, clauseMarker: true } });
    calls(marked, "ketabe man ketabe");
    expect(calls(marked, "ketabe man ketabe")).toEqual([]);
  });
});
