---
title: "Use a worker and load on demand"
description: "Keep conversions off the UI thread, cache assets, and discard stale responses."
---

# Use a worker and load on demand

## Move loading and conversion together

Use the [Vite browser loader](browser.md) as `create-engine.ts`. Put it inside a module worker so model decoding, dictionary construction, and synchronous conversion all run away from the UI thread. Reuse one engine in that worker. The browser still downloads static assets; the worker message sends text within the browser, not over the network.

This worker uses the website's hybrid configuration and its two-alternative/protect-Google controls. The example rejects input longer than 400 UTF-16 code units rather than silently trimming it. That bound belongs to this example application, not to the library.

```ts
// Save as transliterate.worker.ts beside create-engine.ts.
import { createEngine } from "./create-engine";
const scope = self as unknown as DedicatedWorkerGlobalScope;
let engine: Awaited<ReturnType<typeof createEngine>> | undefined;

type Request = { type: "init" } | {
  type: "convert"; id: number; text: string; protectGoogle: boolean;
};
scope.onmessage = async (event: MessageEvent<Request>) => {
  const message = event.data;
  try {
    if (message.type === "init") {
      engine = await createEngine();
      scope.postMessage({ type: "ready" });
    } else {
      if (!engine) throw new Error("Engine is not ready");
      if (message.text.length > 400) throw new Error("Input is too long");
      const result = engine.transliterate(message.text, {
        alternatives: 2,
        protect: message.protectGoogle ? ["google"] : [],
      });
      scope.postMessage({ type: "result", id: message.id, result });
    }
  } catch {
    scope.postMessage({ type: "error" });
  }
};
```

The controller below sends initialization once per worker and waits for `ready` before conversion. Keep these three files together in a Vite project. Include `WebWorker` types when checking the worker file and DOM types when checking the controller.

```ts
// Save as converter.ts. Worker creation is deferred until submit().
import type { TransliterationResult } from "tiny-finglish";

export function createConverter(
  render: (result: TransliterationResult) => void,
  failed: () => void,
) {
  let worker: Worker | undefined;
  let ready = false, busy = false, revision = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let latest: { id: number; text: string; protectGoogle: boolean } | undefined;
  function stop() {
    clearTimeout(timer);
    worker?.terminate();
    worker = undefined;
    ready = busy = false;
  }
  function fail() { stop(); failed(); }
  function watch() { clearTimeout(timer); timer = setTimeout(fail, 30_000); }
  function dispatch() {
    if (!worker || !ready || busy || !latest) return;
    busy = true;
    watch();
    worker.postMessage({ type: "convert", ...latest });
  }
  function start() {
    try {
      const current = new Worker(new URL("./transliterate.worker.ts", import.meta.url), {
        type: "module",
      });
      worker = current;
      current.onerror = () => { if (worker === current) fail(); };
      current.onmessage = event => {
        if (worker !== current) return;
        const message = event.data;
        clearTimeout(timer);
        if (message.type === "ready") { ready = true; dispatch(); }
        else if (message.type === "result") {
          busy = false;
          if (message.id === revision) render(message.result);
          else dispatch();
        } else fail();
      };
      watch();
      current.postMessage({ type: "init" });
    } catch { fail(); }
  }
  function submit(text: string, protectGoogle = false) {
    if (text.length > 400) throw new RangeError("Input is too long");
    latest = { id: ++revision, text, protectGoogle };
    if (!worker) start(); else dispatch();
  }
  return {
    submit,
    retry() { stop(); if (latest) start(); },
    dispose() { ++revision; latest = undefined; stop(); },
  };
}
```

## Connect the controller to your interface

This is a controller excerpt, not a complete UI. Supply `render` and `failed` callbacks, call `submit` on input or protection-option changes, connect `retry` to a visible retry button, and call `dispose` when removing the interface. Keep the original input in the UI. Mark existing output as stale or clear it as soon as input changes; disable copying until the matching result arrives. Handle the input-length error visibly. Empty input must also be submitted so it invalidates an older result.

The revision increments when input changes, before dispatch. There is at most one conversion in flight and one latest pending value. An older response cannot overwrite a newer input, including changes received while assets are loading. The worker is created lazily on the first submission; a page can instead trigger initialization on focus or proximity to the viewport, as Eram does.

The watchdog covers loading and conversion. Failure terminates the worker and clears its state; retry creates a fresh worker and reloads the latest input. The worker's synchronous conversion has no `AbortSignal` API; terminating the worker is how an application interrupts it. Do not automatically retry forever or silently downgrade configurations.

## Cache complete, matching assets

Use hashed or revisioned URLs for JavaScript, weights, and both tables, and let the host provide HTTP caching and compression. Reuse the engine rather than fetching on each keystroke. The library has a word cache, not an HTTP cache, download manager, service worker, or offline guarantee. Browser cache eviction and first-visit connectivity still matter.

If you add offline caching, version the entire asset set together and handle partial downloads. Clear an application's rejected loader promise before retrying. A cache hit does not prove the bytes are valid: check HTTP status and report JSON, decoding, or constructor failures. Restrict asset locations using your application's deployment/CSP policy.

## Measure on real target devices

A worker protects UI responsiveness but does not make conversion free. Measure asset transfer, initialization, cold conversion, warm typing, and UI rendering separately. Test a slow device and a failed download. Published Node benchmarks are not a frame-time promise for a visitor's phone. See [limitations and evaluation](limitations.md).
