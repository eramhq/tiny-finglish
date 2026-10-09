/** Run after npm run build. Checks public docs and executes their actual examples. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = relative => readFileSync(path.join(root, relative), 'utf8');
const nav = JSON.parse(read('docs/navigation.json'));
assert.equal(nav.schemaVersion, 1);
assert.equal(nav.defaultLocale, 'en');
assert.deepEqual(nav.locales, ['en', 'fa']);
const slugPattern = /^[a-z0-9-]+(?:\/[a-z0-9-]+)*$/;
const slugs = nav.sections.flatMap(section => section.pages);
assert.equal(new Set(slugs).size, slugs.length);
assert(slugs.includes(nav.entry));
assert.equal(new Set(nav.sections.map(section => section.id)).size, nav.sections.length);
for (const section of nav.sections) {
  assert(slugPattern.test(section.id));
  assert(section.pages.length);
  for (const lang of nav.locales) assert(section.title[lang]?.trim());
}
const blocks = text => [...text.matchAll(/^```(\w+)\n([\s\S]*?)^```/gm)]
  .map(match => ({ lang: match[1], code: match[2], end: match.index + match[0].length }));
const executable = text => blocks(text).filter(block => ['js', 'ts', 'sh'].includes(block.lang));
let pages = 0;
for (const slug of slugs) {
  assert(slugPattern.test(slug));
  for (const lang of nav.locales) {
    const file = `docs/${lang}/${slug}.md`;
    const text = read(file);
    const metadata = text.match(/^---\ntitle: (.+)\ndescription: (.+)\n---\n/);
    assert(metadata, `Missing frontmatter: ${file}`);
    for (const value of metadata.slice(1)) assert.equal(typeof JSON.parse(value), 'string');
    const prose = text.replace(/^```[^\n]*\n[\s\S]*?^```/gm, '').replace(/`[^`]*`/g, '');
    assert(!/<\/?[A-Za-z][^>]*>/.test(prose), `Raw HTML: ${file}`);
    if (lang === 'fa') {
      assert(/[\u0600-\u06ff]/u.test(JSON.parse(metadata[1])), `Untranslated title: ${file}`);
      assert(!/[\u064b-\u0655\u0670\u06c0]/u.test(prose), `Persian writing marks: ${file}`);
    }
    for (const match of prose.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = match[1];
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      const [relative] = target.split('#');
      const resolved = path.resolve(root, path.dirname(file), relative);
      assert(resolved.startsWith(root), `Link escapes repo: ${file}: ${target}`);
      assert(existsSync(resolved), `Missing link: ${file}: ${target}`);
      if (match[0].startsWith('!')) assert(resolved.startsWith(path.join(root, 'docs/assets/')));
    }
    ++pages;
  }
  assert.deepEqual(executable(read(`docs/en/${slug}.md`)).map(b => [b.lang, b.code]),
    executable(read(`docs/fa/${slug}.md`)).map(b => [b.lang, b.code]), `Code drift: ${slug}`);
}

const scratch = mkdtempSync(path.join(root, '.docs-check-'));
let examples = 0;
try {
  const loader = blocks(read('docs/en/node.md')).find(b => b.lang === 'js');
  writeFileSync(path.join(scratch, 'hybrid.mjs'), loader.code);
  for (const file of ['README.md', ...slugs.map(slug => `docs/en/${slug}.md`)]) {
    const text = read(file);
    for (const block of blocks(text)) {
      if (block.lang !== 'js') continue;
      const expected = text.slice(block.end).match(/^\s*```text\n([\s\S]*?)\n```/);
      if (!expected) {
        assert.equal(block.code, loader.code, `Unverified JS example: ${file}`);
        continue;
      }
      const examplePath = path.join(scratch, `example-${examples++}.mjs`);
      writeFileSync(examplePath, block.code);
      const actual = execFileSync(process.execPath, [examplePath], { cwd: root, encoding: 'utf8' });
      assert.equal(actual.trimEnd(), expected[1], `Recorded output differs: ${file}`);
    }
  }

  const browser = blocks(read('docs/en/browser.md')).filter(b => b.lang === 'ts');
  const ui = blocks(read('docs/en/ui-integration.md')).find(b => b.lang === 'ts');
  const worker = blocks(read('docs/en/workers.md')).filter(b => b.lang === 'ts');
  for (const [name, code] of [
    ['create-engine.ts', browser[0].code], ['browser-example.ts', browser[1].code],
    ['reviewed-text.ts', ui.code], ['transliterate.worker.ts', worker[0].code], ['converter.ts', worker[1].code],
    ['vite-env.d.ts', 'declare module "*?url" { const url: string; export default url; }'],
  ]) writeFileSync(path.join(scratch, name), code);
  execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'),
    '--noEmit', '--strict', '--skipLibCheck', '--target', 'ES2022', '--module', 'ESNext',
    '--moduleResolution', 'bundler', '--lib', 'ES2022,DOM,WebWorker',
    ...['create-engine.ts', 'browser-example.ts', 'reviewed-text.ts', 'transliterate.worker.ts', 'converter.ts', 'vite-env.d.ts']
      .map(name => path.join(scratch, name)),
  ], { cwd: root, stdio: 'pipe' });

  const assetPlugin = { name: 'documented-asset-urls', setup(builder) {
    builder.onResolve({ filter: /\?url$/ }, args => ({ path: args.path, namespace: 'asset' }));
    builder.onLoad({ filter: /.*/, namespace: 'asset' }, args => ({
      contents: `export default ${JSON.stringify(args.path.replace('?url', ''))};`, loader: 'js',
    }));
  } };
  async function bundle(name) {
    const outfile = path.join(scratch, `${name}.mjs`);
    await build({ entryPoints: [path.join(scratch, `${name}.ts`)], outfile, bundle: true,
      platform: 'browser', format: 'esm', target: 'es2022', plugins: [assetPlugin] });
    return import(pathToFileURL(outfile).href);
  }
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  try {
    globalThis.fetch = async name => {
      ++fetches;
      return new Response(readFileSync(fileURLToPath(import.meta.resolve(name))));
    };
    const { createEngine } = await bundle('create-engine');
    const engine = await createEngine();
    assert.equal(fetches, 3);
    assert.equal(engine.transliterate('salam, emrooz miram shiraz').text, 'سلام، امروز میرم شیراز');
    const { reviewedText } = await bundle('reviewed-text');
    const result = engine.transliterate('hamele');
    assert.equal(reviewedText(result, new Map([[0, 'حامل']])), 'حامل');
    assert.equal(reviewedText(result, new Map([[0, 'not-a-candidate']])), result.text);
    globalThis.fetch = async () => new Response('missing', { status: 404 });
    await assert.rejects(createEngine, /Asset HTTP 404/);
    globalThis.fetch = async () => new Response('not json or a table');
    await assert.rejects(createEngine);
  } finally { globalThis.fetch = originalFetch; }

  const { createConverter } = await bundle('converter');
  const originalWorker = globalThis.Worker;
  const originalSetTimeout = globalThis.setTimeout, originalClearTimeout = globalThis.clearTimeout;
  const instances = [], timers = new Map();
  let timerId = 0;
  class FakeWorker {
    sent = []; terminated = false;
    constructor() { instances.push(this); }
    postMessage(message) { this.sent.push(message); }
    terminate() { this.terminated = true; }
    emit(data) { this.onmessage({ data }); }
  }
  try {
    globalThis.Worker = FakeWorker;
    globalThis.setTimeout = callback => { timers.set(++timerId, callback); return timerId; };
    globalThis.clearTimeout = id => timers.delete(id);
    const rendered = []; let failures = 0;
    const converter = createConverter(result => rendered.push(result), () => ++failures);
    assert.equal(instances.length, 0, 'must load lazily');
    converter.submit('first');
    const first = instances[0];
    converter.submit('second', true);
    assert.deepEqual(first.sent, [{ type: 'init' }]);
    first.emit({ type: 'ready' });
    assert.deepEqual(first.sent[1], { type: 'convert', id: 2, text: 'second', protectGoogle: true });
    converter.submit('third');
    assert.equal(first.sent.length, 2, 'only one conversion in flight');
    first.emit({ type: 'result', id: 2, result: 'stale' });
    assert.equal(rendered.length, 0);
    assert.equal(first.sent[2].text, 'third');
    converter.submit('');
    first.emit({ type: 'result', id: 3, result: 'also stale' });
    assert.equal(first.sent[3].text, '');
    first.emit({ type: 'result', id: 4, result: 'empty result' });
    assert.deepEqual(rendered, ['empty result']);
    converter.submit('retry this');
    first.emit({ type: 'error' });
    assert(first.terminated);
    assert.equal(failures, 1);
    converter.retry();
    const second = instances[1];
    first.emit({ type: 'result', id: 5, result: 'old worker' });
    assert.equal(rendered.length, 1);
    second.emit({ type: 'ready' });
    assert.equal(second.sent[1].text, 'retry this');
    assert.equal(timers.size, 1);
    [...timers.values()][0]();
    assert.equal(failures, 2, 'watchdog failure');
    assert(second.terminated);
    assert.throws(() => converter.submit('a'.repeat(401)), RangeError);
    converter.dispose();
    assert.equal(timers.size, 0);
  } finally {
    globalThis.Worker = originalWorker;
    globalThis.setTimeout = originalSetTimeout; globalThis.clearTimeout = originalClearTimeout;
  }
  console.log(`${pages} bilingual pages: navigation, metadata, links, Persian marks, and code parity passed.`);
  console.log(`${examples} recorded JavaScript examples passed; browser/UI/worker TypeScript checked.`);
  console.log('Browser asset loading and failures, reviewed choices, lazy worker, stale replies, retry, timeout, and disposal passed.');
} finally { rmSync(scratch, { recursive: true, force: true }); }
