// Bundles the game into one self-contained HTML file.
//
// Browsers refuse to load ES modules over file://, so double-clicking
// index.html shows nothing.  This build inlines every module, plus the CSS,
// into a single page that runs straight off the filesystem — no server, no
// installed toolchain, nothing to unpack.
//
//   node tools/build-standalone.mjs        -> aurelia.html
//
// Each module keeps its own scope (an IIFE returning its exports), so
// same-named module-level constants across files cannot collide.

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const ENTRY = join(SRC, 'main.js');
const OUT = join(ROOT, 'aurelia.html');

const IMPORT_RE = /^[ \t]*import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"];?[ \t]*$/gm;
const EXPORT_RE = /^export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;

async function jsFiles(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await jsFiles(p));
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

const idOf = (file) => relative(SRC, file).replace(/[^\w]/g, '_');

async function parse(file) {
  const raw = await readFile(file, 'utf8');
  const imports = [];
  for (const m of raw.matchAll(IMPORT_RE)) {
    imports.push({
      names: m[1].split(',').map((s) => s.trim()).filter(Boolean),
      file: resolve(dirname(file), m[2]),
    });
  }
  const exports = [...raw.matchAll(EXPORT_RE)].map((m) => m[1]);
  const body = raw.replace(IMPORT_RE, '').replace(/^export\s+/gm, '');
  return { file, imports, exports, body };
}

function order(modules, entry) {
  const sorted = [];
  const state = new Map();
  const visit = (file, stack) => {
    if (state.get(file) === 'done') return;
    if (state.get(file) === 'visiting') {
      throw new Error('circular import: ' + [...stack, file].map((f) => relative(SRC, f)).join(' -> '));
    }
    state.set(file, 'visiting');
    const m = modules.get(file);
    if (!m) throw new Error('missing module ' + file);
    for (const imp of m.imports) visit(imp.file, [...stack, file]);
    state.set(file, 'done');
    sorted.push(m);
  };
  visit(entry, []);
  return sorted;
}

function emit(m, modules) {
  const id = idOf(m.file);
  const lines = [`/* ===== ${relative(ROOT, m.file)} ===== */`];
  const open = m.exports.length ? `const ${id} = (() => {` : `(() => {`;
  lines.push(open);
  for (const imp of m.imports) {
    const bindings = imp.names.map((n) => {
      const [orig, alias] = n.split(/\s+as\s+/).map((s) => s.trim());
      const dep = modules.get(imp.file);
      if (!dep.exports.includes(orig)) {
        throw new Error(`${relative(SRC, m.file)} imports "${orig}" which ${relative(SRC, imp.file)} does not export`);
      }
      return alias ? `${orig}: ${alias}` : orig;
    }).join(', ');
    lines.push(`  const { ${bindings} } = ${idOf(imp.file)};`);
  }
  lines.push(m.body.trim());
  if (m.exports.length) lines.push(`  return { ${m.exports.join(', ')} };`);
  lines.push(m.exports.length ? '})();' : '})();');
  return lines.join('\n');
}

const files = await jsFiles(SRC);
const modules = new Map();
for (const f of files) modules.set(f, await parse(f));

const sorted = order(modules, ENTRY);
const unreached = files.filter((f) => !sorted.some((m) => m.file === f));
if (unreached.length) {
  console.warn('note: not reachable from the entry point:', unreached.map((f) => relative(SRC, f)).join(', '));
}

const bundle = sorted.map((m) => emit(m, modules)).join('\n\n');
const css = await readFile(join(ROOT, 'styles.css'), 'utf8');
const html = await readFile(join(ROOT, 'index.html'), 'utf8');

const page = html
  .replace('<link rel="stylesheet" href="styles.css" />', `<style>\n${css}\n</style>`)
  .replace('<script type="module" src="src/main.js"></script>',
    `<script type="module">\n${bundle}\n</script>`)
  .replace('<title>', '<!-- Built by tools/build-standalone.mjs — edit src/, not this file. -->\n<title>');

// Guard against index.html drifting away from the tags we replace.
for (const tag of ['href="styles.css"', 'src="src/main.js"']) {
  if (page.includes(tag)) {
    throw new Error(`inlining failed: ${tag} is still linked — update tools/build-standalone.mjs`);
  }
}

await writeFile(OUT, page);
console.log(`${relative(ROOT, OUT)}  —  ${sorted.length} modules, ${(page.length / 1024).toFixed(0)} KB`);
