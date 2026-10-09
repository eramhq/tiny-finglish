---
title: "استفاده در Node.js"
description: "فایل‌های داده را بخوانید، موتور ترکیبی بسازید و مسیر ورود مناسب را انتخاب کنید."
---

# استفاده در Node.js

## نیازمندی‌های اجرا و قالب ماژول

بسته ساخته‌شده از نوع ESM است، کد ES2022 تولید می‌کند و وابستگی زمان اجرا ندارد. مشخصات آن Node `>=20.10` را اعلام می‌کند. مثال‌ها و بررسی‌های این راهنما با Node 24.8.0 اجرا شده‌اند؛ این بررسی به معنی تایید همه نسخه‌های مجاز در مشخصات بسته نیست. از پسوند `.mjs` یا پروژه‌ای با `"type": "module"` استفاده کنید. خروجی CommonJS برای `require` وجود ندارد.

ساخت از منبع نیاز جداگانه‌ای دارد: `npm run build` برای اجرای `scripts/package-data.ts` از `node --experimental-strip-types` استفاده می‌کند. Node 20 نمی‌تواند این دستور ساخت را اجرا کند. برای روش نصب این راهنما از Node 24 استفاده کنید. اجرای بسته ساخته‌شده به حذف نوع‌های تایپ‌اسکریپت، DOM، پردازنده گرافیکی، پایتون یا آموزش مدل نیاز ندارد.

## بارگذاری تنظیم ترکیبی وب‌سایت

ابتدا [آرشیو منبع را نصب کنید](installation.md). بارگذار زیر را با نام `hybrid.mjs` ذخیره کنید. این کد سه فایل داده را از مسیرهای عمومی بسته می‌خواند؛ به چیدمان `node_modules` یا شیوه واردکردن JSON در نسخه‌های مختلف Node وابسته نیست.

```js
// Save as hybrid.mjs after installing the source archive.
import { readFileSync } from "node:fs";
import {
  Transliterator, decodeFrequencyTable, decodeVowelTable,
} from "tiny-finglish";

const read = (name) => readFileSync(
  new URL(import.meta.resolve(`tiny-finglish/${name}`)),
);
export const model = JSON.parse(read("weights.json").toString("utf8"));
export const frequency = decodeFrequencyTable(read("frequency.bin"));
export const vowels = decodeVowelTable(read("vowels.bin"));
export const engine = new Transliterator({ model, frequency, vowels });
```

کد زیر را با نام `example.mjs` کنار بارگذار ذخیره و با `node example.mjs` اجرا کنید:

```js
import { engine } from "./hybrid.mjs";
console.log(engine.transliterate("salam, emrooz miram shiraz").text);
```

```text
سلام، امروز میرم شیراز
```

این همان تنظیم موتور ارم است: با وجود مدل، مقدار پیش‌فرض `hybrid` برابر `true` است و جدول جفت‌واژه‌ها یا واژه‌نامه بارگذاری نمی‌شود. داده از دیسک خوانده می‌شود و هنگام تبدیل دانلودی انجام نمی‌شود. موتور را یک بار بسازید و دوباره استفاده کنید. برای برنامه‌ها یا درخواست‌هایی با تنظیم متفاوت، نمونه جدا بسازید؛ `configure()` موتور پیش‌فرض مشترک ماژول را جایگزین می‌کند و مختص یک درخواست نیست.

## مسیرهای عمومی بسته

| مسیر واردکردن | خروجی و کاربرد |
|---|---|
| `tiny-finglish` | `Transliterator`، `transliterate`، `configure`، `RuleTransliterator`، جداساز متن، یکسان‌ساز، رمزگشای جدول‌ها، ابزارهای فشرده‌سازی پیشوندی و نوع‌های عمومی نتیجه و مدل |
| `tiny-finglish/rules` | `RuleTransliterator`، `RuleBaseline`، `matchKeySet` و نوع‌ها و ابزارهای مشترک؛ بدون اجرای مدل عصبی و بدون تابع سطح ماژول `transliterate` |
| `tiny-finglish/normalize` | `normalize`، `foldForMatch`، `isNormalized` و نوع‌های یکسان‌سازی |
| `tiny-finglish/metrics` | ابزارهای ارزیابی مانند `wordAccuracy`، `orthographicWordAccuracy`، `acceptedWordAccuracy` و `characterErrorRate` |
| `tiny-finglish/weights.json` | فایل JSON وزن‌ها؛ پیش از ارسال به `model` آن را بخوانید و تجزیه کنید |
| `tiny-finglish/frequency.bin` | بایت‌های غیرفشرده جدول؛ نیازمند `decodeFrequencyTable` |
| `tiny-finglish/vowels.bin` | بایت‌های غیرفشرده جدول؛ نیازمند `decodeVowelTable` |

فهرست خروجی‌های بسته، `src/`، مسیر دلخواه در `dist/`، فایل `bigram.bin` یا فایل واژه‌نامه را در دسترس نمی‌گذارد. فقط از مسیرهای پشتیبانی‌شده استفاده کنید. داده‌های مخصوص مخزن در [تنظیم‌های اختیاری](configurations.md) و ساختار پاسخ در [راهنمای نتیجه](results.md) توضیح داده شده‌اند.
