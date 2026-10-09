---
title: "بارگذاری موتور در مرورگر"
description: "فایل‌های ثابت مدل و جدول‌ها را دریافت و پیش از تبدیل رمزگشایی کنید."
---

# بارگذاری موتور در مرورگر

## راه‌اندازی با Vite، مانند ارم

[آرشیو منبع را نصب کنید](installation.md) و نوع‌های سمت مرورگر Vite را فعال کنید؛ برای مثال، `/// <reference types="vite/client" />` را در `vite-env.d.ts` قرار دهید تا تایپ‌اسکریپت `?url` را بشناسد. این پسوند قابلیت ابزار ساخت است، نه دستور واردکردن فایل در مرورگر یا مسیر عمومی دیگری در بسته.

```ts
// Save as create-engine.ts in a Vite application.
import {
  Transliterator, decodeFrequencyTable, decodeVowelTable,
  type WeightArtifact,
} from "tiny-finglish";
import weightsUrl from "tiny-finglish/weights.json?url";
import frequencyUrl from "tiny-finglish/frequency.bin?url";
import vowelsUrl from "tiny-finglish/vowels.bin?url";

async function asset(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Asset HTTP ${response.status}: ${url}`);
  return response;
}

export async function createEngine(): Promise<Transliterator> {
  const [model, frequencyBytes, vowelBytes] = await Promise.all([
    asset(weightsUrl).then(r => r.json() as Promise<WeightArtifact>),
    asset(frequencyUrl).then(r => r.arrayBuffer()),
    asset(vowelsUrl).then(r => r.arrayBuffer()),
  ]);
  return new Transliterator({
    model,
    frequency: decodeFrequencyTable(new Uint8Array(frequencyBytes)),
    vowels: decodeVowelTable(new Uint8Array(vowelBytes)),
  });
}
```

پس از راه‌اندازی بالا، فراخوانی زیر خروجی ثبت‌شده را تولید می‌کند:

```ts
import { createEngine } from "./create-engine";
const engine = await createEngine();
console.log(engine.transliterate("salam, emrooz miram shiraz").text);
```

```text
سلام، امروز میرم شیراز
```

سه ورودی داده و تنظیم سازنده با نسخه منبع وب‌سایت، `96b9ff39d9accff72b8d634925833a5d6f337c97`، یکسان‌اند. جدول جفت‌واژه‌ها و واژه‌نامه بارگذاری نمی‌شوند. ساخت موتور به دلیل دریافت فایل‌ها ناهمگام است، اما خود `engine.transliterate()` همگام اجرا می‌شود. برای تبدیل هنگام تایپ، این بارگذار را داخل [Worker ماژولی](workers.md) اجرا کنید.

## بایت‌های درست را به رمزگشا بدهید

فایل‌های `.bin` آرشیو از قبل از حالت فشرده خارج شده‌اند. `fetch` فشرده‌سازی انتقال HTTP را مدیریت می‌کند؛ پاسخ را به `Uint8Array` تبدیل کنید و یک بار به رمزگشای مربوط بدهید. فایل‌های مشابه در `data/lexicon/` مخزن با Brotli فشرده شده‌اند و جایگزین مستقیم خروجی‌های بسته نیستند.

فایل‌ها را با نوع محتوا، فشرده‌سازی، سرآیند کش و شناسه انتشار هماهنگ میزبانی کنید. به جای جدول رمزگشایی‌شده، نشانی فایل، `ArrayBuffer`، بایت فشرده مخزن یا شیء JSON ندهید. اعلام نوع تایپ‌اسکریپت برای JSON مدل، داده را هنگام اجرا اعتبارسنجی نمی‌کند؛ از فایل‌های هماهنگ و بازبینی‌شده استفاده کنید.

## ابزارهای ساخت دیگر و میزبانی ایستا

در ابزار ساخت دیگر، روش پشتیبانی‌شده همان ابزار را برای نشانی فایل به کار ببرید. بدون ابزار ساخت، ابتدا یک بسته ESM مناسب مرورگر بسازید، سه فایل داده بسته را در فایل‌های ثابت سایت قرار دهید و نشانی‌های واردشده را با نشانی‌های میزبانی خود عوض کنید. مرورگر به تنهایی نام بسته را پیدا نمی‌کند. مسیر نصب سایت در زیرپوشه و CORS برای فایل‌های روی دامنه دیگر را در نظر بگیرید.

موتور به جاوااسکریپت جدید با پشتیبانی ES2022 و آرایه‌های نوع‌دار نیاز دارد؛ این بارگذار به `fetch` هم نیاز دارد. WebGPU یا سرویس مدل استفاده نمی‌شود. خطای شبکه، JSON نامعتبر یا خطای رمزگشا و سازنده باید به وضعیت قابل تلاش دوباره منجر شود. اگر به قواعد ساده برمی‌گردید، خروجی را ترکیبی معرفی نکنید. [بارگذاری و کش](workers.md) و [رفع اشکال](limitations.md) را ببینید.
