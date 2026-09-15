"""
Run `elektito/finglish` over an evaluation set and emit its raw outputs.

Deliberately does no scoring. It reads JSONL on stdin and writes JSON on
stdout, and `scripts/compare.ts` scores what comes back with the same
`wordAccuracy` it applies to every other subject. Scoring here in Python would
mean two implementations of the metric and, sooner or later, two different
answers to the same question.

Invoked by `scripts/compare.ts` through `training/.venv`, where the package is
installed as a comparison-only dependency:

    uv pip install finglish          # VIRTUAL_ENV=training/.venv
"""

import contextlib
import json
import sys
import time


def main() -> int:
    # Importing the package prints "Loading converters..." and two more lines to
    # stdout as it reads its 7.1 MB frequency table. Those land in the middle of
    # our JSON if left alone, so stdout is pointed at stderr for the duration —
    # the messages stay visible to anyone running this by hand, just not on the
    # channel carrying the result.
    try:
        with contextlib.redirect_stdout(sys.stderr):
            from finglish import f2p
    except ImportError:
        json.dump({"available": False, "reason": "finglish is not installed"}, sys.stdout)
        return 0

    cases = [json.loads(line) for line in sys.stdin if line.strip()]

    outputs: list[str] = []
    started = time.perf_counter()
    for case in cases:
        try:
            outputs.append(f2p(case["input"]))
        except Exception as error:  # noqa: BLE001 - a crash is a result, not a stop
            outputs.append(f"<error: {type(error).__name__}: {error}>")
    elapsed_ms = (time.perf_counter() - started) * 1000

    with contextlib.redirect_stdout(sys.stderr):
        from finglish import version

    json.dump(
        {
            "available": True,
            "version": getattr(version, "__version__", None) or getattr(version, "version", None),
            "outputs": outputs,
            "totalMs": elapsed_ms,
            "msPerCase": elapsed_ms / len(cases) if cases else 0.0,
        },
        sys.stdout,
        ensure_ascii=False,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
