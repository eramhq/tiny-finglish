---
title: "انتخاب تنظیم موتور"
description: "قواعد، جدول واژه‌ها، روش ترکیبی و داده اختیاری بافت جمله را مقایسه کنید."
---

# انتخاب تنظیم موتور

## مقایسه تنظیم‌های کامل

این مثال اجرایی از داده‌های [بارگذار `hybrid.mjs` در Node.js](node.md) استفاده می‌کند. آن را کنار همان فایل ذخیره کنید. سه روش در این پیام کوتاه خروجی یکسان دارند، اما گزینه‌ها و امتیازهایشان متفاوت است؛ یک مثال برای مقایسه دقت کافی نیست.

```js
import { Transliterator } from "tiny-finglish";
import { RuleTransliterator } from "tiny-finglish/rules";
import { model, frequency, vowels } from "./hybrid.mjs";

const engines = [
  ["rules", new RuleTransliterator()],
  ["tables", new RuleTransliterator({ frequency, vowels })],
  ["hybrid", new Transliterator({ model, frequency, vowels })],
  ["model", new Transliterator({ model, frequency, vowels, hybrid: false })],
];
for (const [name, engine] of engines) {
  console.log(name + ": " + engine.transliterate("salam, emrooz miram shiraz").text);
}
```

```text
rules: سلم، امروز میرم شیرز
tables: سلام، امروز میرم شیراز
hybrid: سلام، امروز میرم شیراز
model: سلام، امروز میرم شیراز
```

## تفاوت روش‌ها

روش فقط قواعد به داده خارجی نیاز ندارد. استثناهای داخلی، وام‌واژه‌ها، حفظ بخش‌های متن و پردازش جمله همچنان اجرا می‌شوند. `new Transliterator()` و `new RuleTransliterator()` از مسیر مشترک بدون مدل استفاده می‌کنند؛ واردکردن دومی از `/rules` کد اجرای مدل عصبی را وارد برنامه نمی‌کند.

جدول فراوانی، واژه‌های رایج فارسی را در رتبه‌بندی دخالت می‌دهد و نمایه واژه‌ها را برای موتور قواعد می‌سازد. جدول واکه، اطلاعات تلفظ واژه‌های مشابه را فراهم می‌کند. برای روش قواعد همراه جدول‌ها، هر دو را بارگذاری کنید. فرستادن جدول واکه به تنهایی پذیرفته می‌شود، اما همان تنظیم ارزیابی‌شده این راهنما نیست.

روش ترکیبی، گزینه‌ها و شواهد مدل را به رتبه‌بندی قواعد اضافه می‌کند. با وجود `model` این روش پیش‌فرض است، اما **کتابخانه وزن‌ها یا جدول‌ها را خودکار بارگذاری نمی‌کند**. اگر `model` ندهید، `hybrid: true` هم از قواعد استفاده می‌کند. روش ترکیبی می‌تواند املای دارای نیم‌فاصله مدل را انتخاب کند، ولی درست‌بودن همه نیم‌فاصله‌ها را تضمین نمی‌کند.

با `hybrid: false`، تولید گزینه‌ها بر عهده مدل است. رتبه‌بندی فراوانی، اصلاح واکه، وام‌واژه‌ها و دیگر مراحل مشترک، در صورت کاربرد همچنان اجرا می‌شوند. پس «فقط مدل» به تولید گزینه‌ها اشاره دارد و به معنی حذف همه قواعد قطعی نیست. در مقایسه بالا، این روش هم هر دو جدول را دارد.

## جدول جفت‌واژه‌ها و واژه‌نامه اختیاری

گزینه `bigram` یک `BigramTable` رمزگشایی‌شده می‌گیرد تا پردازش جمله، با امتیاز واژه‌های مجاور از میان گزینه‌ها انتخاب کند. گزینه `lexicon` یک `ReadonlySet<string>` از شکل‌های نوشتاری فارسی می‌گیرد و بر رتبه‌بندی قواعد و انتخاب میان گزینه‌های نزدیک اثر می‌گذارد. با `useLexiconSnap: true`، تطبیق خروجی مدل با واژه‌نامه در مسیر فقط مدل نیز فعال می‌شود. این گزینه پیش‌فرض خاموش است و خاموش‌کردن آن همه اثرهای واژه‌نامه را حذف نمی‌کند.

هیچ‌یک از دو فایل اختیاری، خروجی عمومی بسته نیستند. مثال زیر برای آزمایش در همین مخزن است: فایل‌های مخزن را از حالت Brotli خارج می‌کند و مدل و جدول‌های فعلی را نگه می‌دارد. پس از ساخت بسته، آن را از ریشه مخزن اجرا کنید؛ این کد مخصوص مرورگر نیست.

```js
import { readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import {
  Transliterator, decodeBigramTable, decodeFrontCoded,
  decodeFrequencyTable, decodeVowelTable,
} from "tiny-finglish";

const read = name => readFileSync(new URL(import.meta.resolve(`tiny-finglish/${name}`)));
const unpack = name => brotliDecompressSync(readFileSync(`data/lexicon/${name}`));
const engine = new Transliterator({
  model: JSON.parse(read("weights.json").toString("utf8")),
  frequency: decodeFrequencyTable(read("frequency.bin")),
  vowels: decodeVowelTable(read("vowels.bin")),
  bigram: decodeBigramTable(unpack("fa-bigram.bin")),
  lexicon: new Set(decodeFrontCoded(unpack("fa-stems.bin"))),
});
console.log(engine.hasModel, engine.hasContext);
```

```text
true true
```

اگر برنامه از این فایل‌ها استفاده کند، توزیع، بارگذاری و نگهداری اطلاعات منبع بر عهده شماست. داده بیشتر لزوما خروجی بهتری برای متن شما نمی‌دهد؛ روی مجموعه توسعه مناسب کاربرد خود مقایسه کنید. وب‌سایت هیچ‌یک از این دو فایل را بارگذاری نمی‌کند.

## تنظیم نمونه و استفاده دوباره

مقدار پیش‌فرض `cacheSize` برابر `2048` واژه است و قدیمی‌ترین ورودی کش زودتر حذف می‌شود. `scoring` برای تغییر پیشرفته امتیازدهی قواعد است؛ تغییر آن، تنظیم ارزیابی‌شده را عوض می‌کند. جز در آزمایش اندازه‌گیری‌شده، پیش‌فرض‌ها را نگه دارید.

`hasModel` وجود مدل و `hasContext` وجود جدول جفت‌واژه‌ها را نشان می‌دهد. مقدار نادرست دومی به معنی خاموش‌بودن همه پردازش‌های جمله نیست. برای داده یا امتیازدهی متفاوت، نمونه جدا بسازید. گزینه‌های رمزگشایی را در یک نمونه ثابت نگه دارید: کلید کش واژه شامل `beamWidth` و `candidatesPerSpan` نیست، پس تغییر آن‌ها بعد از ذخیره واژه ممکن است گزینه‌ها را دوباره تولید نکند. [کنترل ورودی](input-options.md) و [ارزیابی](limitations.md) را ببینید.
