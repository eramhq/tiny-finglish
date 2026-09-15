"""Training-side code for tiny-finglish.

Nothing in this package ships to the browser. It generates the synthetic
corpus, trains the transducer, evaluates it, and exports quantized weights
plus the parity fixtures that pin the browser runtime to this implementation.
"""

__all__ = ["normalize", "rules", "g2p", "labels", "corpus", "model"]
