"""M2 — the scaling curve. The milestone the plan calls decisive.

Trains the same architecture at four sizes and plots word accuracy against
parameter count, each with and without lexicon assistance, to answer three
questions with data instead of argument:

  1. Does the model absorb Persian orthography, and where does the curve flatten?
  2. Does the size budget survive?
  3. **Does the lexicon need to ship at runtime, or is it only training signal
     and evaluation oracle?**

The capacity arithmetic going in says the model can absorb the vocabulary:
~50,000 words at ~1 bit of genuinely arbitrary choice each is ~50 kbit, and at
a measured ~3.6 bits/parameter that is ~14k parameters before task overhead.
The default position is therefore lexicon-as-oracle-only, with the runtime snap
tier built but disabled. This is where that gets confirmed or falsified.

    python -m tiny_finglish_training.sweep --corpus corpora/full --out runs/m2
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import torch

from .corpus import read
from .export import export_model
from .labels import load_vocabs
from .lexicon import load as load_lexicon
from .model import ModelConfig, build
from .train import evaluate, pick_device

#: Four sizes spanning the plan's 30k-2M range. Depth grows with width so the
#: comparison is of one architecture at four scales, not four architectures.
SIZES = [
    {"name": "30k", "d_model": 32, "d_hidden": 48, "n_layers": 2},
    {"name": "100k", "d_model": 64, "d_hidden": 96, "n_layers": 2},
    {"name": "500k", "d_model": 128, "d_hidden": 192, "n_layers": 3},
    {"name": "2M", "d_model": 224, "d_hidden": 320, "n_layers": 4},
]


def evaluate_with_lexicon(model, examples, inputs, outputs, device, lexicon: frozenset) -> dict:
    """Word accuracy when near-miss outputs are snapped onto attested words.

    This is the optional tier [4] of the pipeline, measured rather than assumed.
    The gap between this and the plain number is exactly the value of shipping
    the lexicon at runtime; if it is small, the lexicon stays in training.
    """
    from .data import encode_batch, length_bucketed

    model.eval()
    plain = snapped = total = 0
    in_lexicon = 0
    with torch.no_grad():
        for batch in length_bucketed(examples, 512):
            ids, _ = encode_batch(batch, inputs, outputs, device=device)
            predictions = model(ids).argmax(dim=-1)
            for row, example in enumerate(batch):
                predicted = "".join(
                    outputs.decode(int(predictions[row, col])) for col in range(len(example.latin))
                )
                plain += predicted == example.persian
                # Snap only when the raw output is not itself a word; a
                # confident in-vocabulary answer is never overridden.
                if predicted in lexicon:
                    best = predicted
                    in_lexicon += 1
                else:
                    best = _nearest(predicted, lexicon)
                snapped += best == example.persian
                total += 1
    return {
        "word_accuracy": plain / max(total, 1),
        "word_accuracy_lexicon": snapped / max(total, 1),
        "in_lexicon_rate": in_lexicon / max(total, 1),
        "words": total,
    }


def _nearest(word: str, lexicon: frozenset, max_distance: int = 1) -> str:
    """Cheapest edit-distance-1 neighbour that is an attested word, else `word`.

    Deliberately limited to distance 1 and to substitutions of the homophone
    classes. A general edit-distance search over 100k words would both be slow
    and paper over real model errors, which would make the M2 comparison
    dishonest in the direction that favours shipping the lexicon.
    """
    if not word or len(word) > 24:
        return word
    homophones = {
        "س": "صث", "ص": "سث", "ث": "سص",
        "ز": "ذضظ", "ذ": "زضظ", "ض": "زذظ", "ظ": "زذض",
        "ت": "ط", "ط": "ت", "ه": "ح", "ح": "ه", "ق": "غ", "غ": "ق",
    }
    for i, ch in enumerate(word):
        for replacement in homophones.get(ch, ""):
            candidate = word[:i] + replacement + word[i + 1 :]
            if candidate in lexicon:
                return candidate
    _ = max_distance
    return word


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--epochs", type=int, default=10)
    parser.add_argument("--batch-size", type=int, default=512)
    parser.add_argument("--device", default="auto")
    parser.add_argument("--only", nargs="*", default=None, help="subset of size names")
    args = parser.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)
    device = pick_device(args.device)
    lexicon = frozenset(load_lexicon())
    test = read(args.corpus / "test.jsonl")
    manifest = json.loads((args.corpus / "manifest.json").read_text())

    rows = []
    for size in SIZES:
        if args.only and size["name"] not in args.only:
            continue
        run_dir = args.out / size["name"]
        print(f"\n=== {size['name']} ===", flush=True)
        subprocess.run(
            [sys.executable, "-m", "tiny_finglish_training.train",
             "--corpus", str(args.corpus), "--out", str(run_dir),
             "--d-model", str(size["d_model"]), "--d-hidden", str(size["d_hidden"]),
             "--n-layers", str(size["n_layers"]), "--epochs", str(args.epochs),
             "--batch-size", str(args.batch_size), "--device", args.device],
            check=True,
        )

        state = torch.load(run_dir / "best.pt", map_location="cpu", weights_only=False)
        config = ModelConfig.from_json(state["config"])
        model = build(config)
        model.load_state_dict(state["model"])
        model.eval().to(device)
        inputs, outputs = load_vocabs(run_dir / "vocab.json")

        float_metrics = evaluate(model, test, inputs, outputs, device)
        lex_metrics = evaluate_with_lexicon(model, test, inputs, outputs, device, lexicon)

        # Accuracy after quantization is the number that ships.
        _, int8_model = export_model(model, inputs, outputs, quant="int8")
        _, int6_model = export_model(model, inputs, outputs, quant="int6")
        int8_metrics = evaluate(int8_model.to(device), test, inputs, outputs, device)
        int6_metrics = evaluate(int6_model.to(device), test, inputs, outputs, device)

        row = {
            "name": size["name"],
            "params": model.parameter_count(),
            "d_model": size["d_model"],
            "d_hidden": size["d_hidden"],
            "n_layers": size["n_layers"],
            "labels": len(outputs),
            "test_char_accuracy": round(float_metrics["char_accuracy"], 4),
            "test_word_accuracy": round(float_metrics["word_accuracy"], 4),
            "test_word_accuracy_int8": round(int8_metrics["word_accuracy"], 4),
            "test_word_accuracy_int6": round(int6_metrics["word_accuracy"], 4),
            "test_word_accuracy_lexicon": round(lex_metrics["word_accuracy_lexicon"], 4),
            "lexicon_gain": round(
                lex_metrics["word_accuracy_lexicon"] - float_metrics["word_accuracy"], 4
            ),
            "in_lexicon_rate": round(lex_metrics["in_lexicon_rate"], 4),
        }
        rows.append(row)
        print(json.dumps(row, indent=2), flush=True)
        (args.out / "curve.json").write_text(
            json.dumps({"corpus": manifest, "rows": rows}, indent=2), encoding="utf-8"
        )

    (args.out / "curve.md").write_text(_render(rows, manifest), encoding="utf-8")
    print("\n" + _render(rows, manifest))


def _render(rows: list[dict], manifest: dict) -> str:
    head = (
        "| size | params | labels | test word acc | int8 | int6 | + lexicon | lexicon gain |\n"
        "|---|---:|---:|---:|---:|---:|---:|---:|\n"
    )
    body = "".join(
        f"| {r['name']} | {r['params']:,} | {r['labels']} | {r['test_word_accuracy']:.4f} | "
        f"{r['test_word_accuracy_int8']:.4f} | {r['test_word_accuracy_int6']:.4f} | "
        f"{r['test_word_accuracy_lexicon']:.4f} | {r['lexicon_gain']:+.4f} |\n"
        for r in rows
    )
    return (
        f"# M2 scaling curve\n\n"
        f"Corpus: {manifest['words']:,} words, {manifest['examples']['train']:,} train / "
        f"{manifest['examples']['test']:,} test examples, hash `{manifest['hash']}`.\n\n"
        f"{head}{body}\n"
        f"Evaluated on held-out **words**, not held-out spellings: the split is by Persian\n"
        f"word before variants are generated, so no test word appears in training under any\n"
        f"spelling.\n"
    )


if __name__ == "__main__":
    main()
