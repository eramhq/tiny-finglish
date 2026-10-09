---
title: "اجرای Worker و بارگذاری هنگام نیاز"
description: "تبدیل را از مسیر رابط جدا کنید، فایل‌ها را کش کنید و نتیجه قدیمی را کنار بگذارید."
---

# اجرای Worker و بارگذاری هنگام نیاز

## بارگذاری و تبدیل را با هم منتقل کنید

[بارگذار مرورگر Vite](browser.md) را با نام `create-engine.ts` ذخیره کنید و داخل Worker ماژولی قرار دهید. در این صورت رمزگشایی مدل، ساخت نمایه واژه‌ها و تبدیل همگام، بیرون از رشته اجرای رابط انجام می‌شوند. در همان Worker یک موتور را دوباره استفاده کنید. مرورگر همچنان فایل‌های ثابت را دانلود می‌کند؛ پیام Worker متن را درون مرورگر جابه‌جا می‌کند، نه روی شبکه.

این Worker از تنظیم ترکیبی وب‌سایت و کنترل‌های دو خروجی جایگزین و حفظ گوگل استفاده می‌کند. مثال، ورودی بیشتر از ۴۰۰ واحد کد UTF-16 را رد می‌کند و بی‌خبر کوتاه نمی‌کند. این حد متعلق به برنامه نمونه است، نه کتابخانه.

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

کنترل‌کننده زیر برای هر Worker یک بار راه‌اندازی را درخواست می‌کند و پیش از تبدیل منتظر `ready` می‌ماند. این سه فایل را کنار هم در پروژه Vite قرار دهید. هنگام بررسی نوع فایل Worker از نوع‌های `WebWorker` و برای کنترل‌کننده از نوع‌های DOM استفاده کنید.

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

## اتصال کنترل‌کننده به رابط

این کد بخش کنترل‌کننده است، نه رابط کامل. تابع‌های `render` و `failed` را فراهم کنید، با تغییر ورودی یا گزینه حفظ، `submit` را صدا بزنید، `retry` را به دکمه تلاش دوباره وصل کنید و هنگام حذف رابط `dispose` را اجرا کنید. ورودی اصلی را در رابط نگه دارید. به محض تغییر ورودی، خروجی موجود را قدیمی مشخص یا پاک کنید و تا رسیدن نتیجه هماهنگ، کپی را غیرفعال کنید. خطای طول ورودی را به کاربر نشان دهید. ورودی خالی را هم بفرستید تا نتیجه قبلی نامعتبر شود.

شناسه بازبینی هنگام تغییر ورودی و پیش از ارسال افزایش می‌یابد. حداکثر یک تبدیل در حال اجرا و یک مقدار تازه منتظر می‌ماند. پاسخ قدیمی نمی‌تواند جای ورودی جدید را بگیرد؛ حتی اگر تغییر هنگام بارگذاری فایل‌ها رخ دهد. Worker در نخستین درخواست ساخته می‌شود. برنامه می‌تواند مانند ارم، با فوکوس یا نزدیک‌شدن بخش به محدوده دید، راه‌اندازی را زودتر آغاز کند.

زمان‌سنج هم بارگذاری و هم تبدیل را پوشش می‌دهد. در خطا، Worker متوقف و وضعیتش پاک می‌شود؛ تلاش دوباره Worker تازه‌ای می‌سازد و آخرین ورودی را بارگذاری می‌کند. تبدیل همگام موتور API مبتنی بر `AbortSignal` ندارد؛ برنامه با پایان‌دادن به Worker آن را قطع می‌کند. تلاش دوباره بی‌پایان یا تغییر بی‌خبر تنظیم موتور مناسب نیست.

## کش‌کردن مجموعه هماهنگ فایل‌ها

برای جاوااسکریپت، وزن‌ها و هر دو جدول از نشانی دارای هش یا نسخه استفاده کنید و کش HTTP و فشرده‌سازی را به میزبان بسپارید. به جای دریافت فایل در هر کلید، موتور را دوباره استفاده کنید. کتابخانه کش واژه دارد، نه کش HTTP، مدیر دانلود، Service Worker یا تضمین کار آفلاین. پاک‌شدن کش مرورگر و اتصال در نخستین بازدید همچنان مهم‌اند.

اگر کش آفلاین اضافه می‌کنید، کل مجموعه فایل‌ها را با هم نسخه‌گذاری کنید و دریافت ناقص را مدیریت کنید. پیش از تلاش دوباره، Promise ناموفق بارگذار برنامه را پاک کنید. وجود داده در کش، معتبر بودن بایت‌ها را ثابت نمی‌کند: وضعیت HTTP را بررسی و خطای JSON، رمزگشایی یا سازنده را گزارش کنید. محل فایل‌ها را با سیاست استقرار و CSP برنامه محدود کنید.

## روی دستگاه هدف اندازه بگیرید

Worker پاسخ‌گویی رابط را بهتر می‌کند، اما هزینه تبدیل را حذف نمی‌کند. انتقال فایل، راه‌اندازی، تبدیل نخست، تایپ با کش گرم و نمایش رابط را جدا اندازه بگیرید. دستگاه کند و دانلود ناموفق را آزمایش کنید. بنچمارک Node وعده زمان پاسخ برای گوشی بازدیدکننده نیست. [محدودیت‌ها و ارزیابی](limitations.md) را ببینید.
