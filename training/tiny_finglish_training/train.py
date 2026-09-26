"""Training entry point.

    python -m tiny_finglish_training.train --corpus corpora/small --out runs/dev

Checkpoints every epoch so a run can resume, because the plan's M2 warns that
corpus size — not model size — is the bottleneck, and a run that cannot resume
is a run you will not repeat.

**Surgery.** ``--surgery-from runs/v8-sentence/best.pt --train-only eos-row``
starts from a trained checkpoint, freezes every parameter, and trains only the
``<eos>`` embedding row — the clause-end marker `data.encode_batch` appends to
`final` examples. A word without the marker never reads that row, so it
computes exactly what the source checkpoint computed: only clause-final words
can change, by construction. The run keeps the source's vocabularies, drops
train examples with a label outside them, and trains on the `final` examples
alone, since no other example reaches the row. It checks before saving that
nothing but that row moved; ``scripts/verify-surgery.ts`` checks the export.
"""

from __future__ import annotations

import argparse
import json
import random
import time
from pathlib import Path

import torch
import torch.nn.functional as F

from .corpus import read
from .data import IGNORE_INDEX, encode_batch, length_bucketed
from .labels import EOS, build_label_vocab, input_vocab, load_vocabs, save_vocabs
from .model import ModelConfig, Transducer, build


def pick_device(requested: str) -> torch.device:
    """Resolve `auto`. MPS is opt-in, not automatic — and that is measured.

    The plan flags PyTorch MPS kernel-launch overhead as a risk for tiny
    tensors. Benchmarked on this model (d=64, h=96, L=2, batch 512, M-series):

        cpu   23 ms/step
        mps   28 ms/step

    CPU wins. The affine scan issues one kernel per timestep per direction per
    layer, so a 20-character word costs ~80 launches per forward, and at this
    tensor size launch overhead dominates the arithmetic. `auto` therefore
    picks CUDA when present and CPU otherwise; pass `--device mps` explicitly
    if a larger config changes the answer, and re-measure rather than assuming.
    """
    if requested != "auto":
        return torch.device(requested)
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


def evaluate(model: Transducer, examples, inputs, outputs, device, batch_size: int = 512) -> dict:
    model.eval()
    char_correct = char_total = word_correct = word_total = 0
    with torch.no_grad():
        for batch in length_bucketed(examples, batch_size):
            ids, targets = encode_batch(batch, inputs, outputs, device=device)
            predictions = model(ids).argmax(dim=-1)
            mask = targets != IGNORE_INDEX
            char_correct += int(((predictions == targets) & mask).sum())
            char_total += int(mask.sum())
            for row, example in enumerate(batch):
                width = len(example.latin)
                predicted = "".join(
                    outputs.decode(int(predictions[row, col])) for col in range(width)
                )
                word_correct += predicted == example.persian
                word_total += 1
    model.train()
    return {
        "char_accuracy": char_correct / max(char_total, 1),
        "word_accuracy": word_correct / max(word_total, 1),
        "words": word_total,
    }


def surgery_mask(model: Transducer, eos: int) -> torch.Tensor:
    """Freeze everything but the `<eos>` embedding row; return that row's mask."""
    for parameter in model.parameters():
        parameter.requires_grad_(False)
    weight = model.embed.weight
    weight.requires_grad_(True)
    mask = torch.zeros(weight.shape[0], 1, dtype=weight.dtype, device=weight.device)
    mask[eos] = 1.0
    # Every row but <eos> gets a zero gradient. With no weight decay on the
    # optimizer, AdamW's update for a row whose gradient was always zero is
    # exactly zero, so those rows stay bit-identical.
    weight.register_hook(lambda grad: grad * mask)
    return mask


def assert_surgery(model: Transducer, source: dict, eos: int) -> None:
    """Fail loudly if anything but the `<eos>` embedding row differs from `source`."""
    for name, tensor in model.state_dict().items():
        before = source[name].to(tensor.device)
        if name == "embed.weight":
            keep = torch.ones(tensor.shape[0], dtype=torch.bool, device=tensor.device)
            keep[eos] = False
            if not torch.equal(tensor[keep], before[keep]):
                raise SystemExit("surgery: an embedding row other than <eos> moved")
        elif not torch.equal(tensor, before):
            raise SystemExit(f"surgery: {name} moved")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--corpus", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--d-model", type=int, default=64)
    parser.add_argument("--d-hidden", type=int, default=96)
    parser.add_argument("--n-layers", type=int, default=2)
    parser.add_argument("--epochs", type=int, default=12)
    parser.add_argument("--batch-size", type=int, default=512)
    parser.add_argument("--lr", type=float, default=3e-3)
    parser.add_argument("--weight-decay", type=float, default=0.01)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument("--device", default="auto")
    parser.add_argument("--min-label-count", type=int, default=2)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--surgery-from", type=Path, default=None,
                        help="start from this checkpoint and train only --train-only; see the module docstring")
    parser.add_argument("--train-only", choices=["eos-row"], default=None)
    args = parser.parse_args()
    surgery = args.surgery_from is not None
    if surgery != (args.train_only is not None):
        parser.error("--surgery-from and --train-only go together")
    if surgery and args.resume:
        parser.error("--resume is not supported with --surgery-from")

    torch.manual_seed(args.seed)
    random.seed(args.seed)
    device = pick_device(args.device)
    args.out.mkdir(parents=True, exist_ok=True)

    train_examples = read(args.corpus / "train.jsonl")
    dev_examples = read(args.corpus / "dev.jsonl")

    vocab_path = args.out / "vocab.json"
    source_state = None
    if surgery:
        # The source's vocabularies, not the corpus's: the model's rows are
        # indexed by them, and a label it has no row for cannot be learned by
        # an embedding row anyway.
        inputs, outputs = load_vocabs(args.surgery_from.parent / "vocab.json")
        save_vocabs(vocab_path, inputs, outputs)
        source_state = torch.load(args.surgery_from, map_location="cpu", weights_only=False)
        known = set(outputs.symbols)
        fits = lambda e: all(label in known for label in e.labels)
        dropped = sum(not fits(e) for e in train_examples)
        train_examples = [e for e in train_examples if e.final and fits(e)]
        dev_examples = [e for e in dev_examples if fits(e)]
        print(f"surgery from {args.surgery_from}: {len(train_examples):,} final train examples "
              f"({dropped} dropped for a label outside the source vocab)")
    elif args.resume and vocab_path.exists():
        inputs, outputs = load_vocabs(vocab_path)
    else:
        inputs = input_vocab()
        # Built from TRAIN ONLY. Including dev/test labels would let the model
        # see which outputs are possible for held-out words.
        outputs, counts = build_label_vocab(
            [e.labels for e in train_examples], min_count=args.min_label_count
        )
        save_vocabs(vocab_path, inputs, outputs)
        print(f"labels: {len(outputs)} kept of {len(counts)} seen (min_count={args.min_label_count})")

    if source_state is not None:
        config = ModelConfig.from_json(source_state["config"])
    else:
        config = ModelConfig(
            input_vocab=len(inputs),
            output_vocab=len(outputs),
            d_model=args.d_model,
            d_hidden=args.d_hidden,
            n_layers=args.n_layers,
        )
    model = build(config).to(device)
    eos = inputs.encode(EOS)
    if source_state is not None:
        model.load_state_dict(source_state["model"])
        surgery_mask(model, eos)
        optimizer = torch.optim.AdamW([model.embed.weight], lr=args.lr, weight_decay=0.0)
        final_dev = [e for e in dev_examples if e.final]
        print(f"source on dev: {evaluate(model, dev_examples, inputs, outputs, device)}  "
              f"final only: {evaluate(model, final_dev, inputs, outputs, device)}")
    else:
        optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.weight_decay)
    # Recorded in the checkpoint so the export can tell the runtime to send the
    # marker: any model that trained on `final` examples has learned to read it.
    extra = {"clause_marker": True, "surgery_from": str(args.surgery_from)} if surgery \
        else {"clause_marker": True} if any(e.final for e in train_examples) else {}

    start_epoch = 0
    checkpoint_path = args.out / "last.pt"
    if args.resume and checkpoint_path.exists():
        state = torch.load(checkpoint_path, map_location=device, weights_only=False)
        model.load_state_dict(state["model"])
        optimizer.load_state_dict(state["optimizer"])
        start_epoch = state["epoch"] + 1
        print(f"resumed from epoch {start_epoch}")

    batches = length_bucketed(train_examples, args.batch_size)
    total_steps = max(1, args.epochs * len(batches))
    schedule = torch.optim.lr_scheduler.OneCycleLR(
        optimizer, max_lr=args.lr, total_steps=total_steps, pct_start=0.15,
        last_epoch=start_epoch * len(batches) - 1 if start_epoch else -1,
    )

    print(
        f"device={device} params={model.parameter_count():,} "
        f"train={len(train_examples):,} dev={len(dev_examples):,} batches={len(batches)}"
    )

    best = {"word_accuracy": -1.0}
    history = []
    for epoch in range(start_epoch, args.epochs):
        random.shuffle(batches)
        started = time.perf_counter()
        running = 0.0
        for batch in batches:
            ids, targets = encode_batch(batch, inputs, outputs, device=device)
            logits = model(ids)
            loss = F.cross_entropy(
                logits.reshape(-1, logits.shape[-1]), targets.reshape(-1),
                ignore_index=IGNORE_INDEX,
            )
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            schedule.step()
            running += float(loss.detach())

        metrics = evaluate(model, dev_examples, inputs, outputs, device)
        if surgery:
            metrics["final_word_accuracy"] = evaluate(model, final_dev, inputs, outputs, device)["word_accuracy"]
            assert_surgery(model, source_state["model"], eos)
        elapsed = time.perf_counter() - started
        record = {
            "epoch": epoch,
            "loss": running / len(batches),
            "seconds": round(elapsed, 1),
            **metrics,
        }
        history.append(record)
        print(
            f"epoch {epoch:>3}  loss {record['loss']:.4f}  "
            f"dev char {metrics['char_accuracy']:.4f}  word {metrics['word_accuracy']:.4f}  "
            + (f"final {metrics['final_word_accuracy']:.4f}  " if surgery else "")
            + f"{elapsed:.1f}s"
        )

        torch.save(
            {"model": model.state_dict(), "optimizer": optimizer.state_dict(),
             "epoch": epoch, "config": config.to_json(), **extra},
            checkpoint_path,
        )
        if metrics["word_accuracy"] > best["word_accuracy"]:
            best = record
            torch.save({"model": model.state_dict(), "config": config.to_json(), "epoch": epoch, **extra},
                       args.out / "best.pt")

    (args.out / "history.json").write_text(
        json.dumps({"args": {k: str(v) for k, v in vars(args).items()},
                    "params": model.parameter_count(),
                    "best": best, "history": history}, indent=2),
        encoding="utf-8",
    )
    print(f"best dev word accuracy {best['word_accuracy']:.4f} at epoch {best['epoch']}")


if __name__ == "__main__":
    main()
