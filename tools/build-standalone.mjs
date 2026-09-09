// Bundles the game into one self-contained HTML file.
//
// Browsers refuse to load ES modules over file://, so double-clicking
// index.html shows nothing.  This build inlines every module, plus the CSS,
// into a single page that runs straight off the filesystem — no server, no
// installed toolchain, nothing to unpack.
//
//   node tools/build-standalone.mjs                       -> aurelia.html
//   node tools/build-standalone.mjs <entry.js> <page.html> <out.html>
//
// Each module keeps its own scope (an IIFE returning its exports), so
// same-named module-level constants across files cannot collide.

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [entryArg, htmlArg, outArg] = process.argv.slice(2);
const ENTRY = resolve(ROOT, entryArg || 'src/main.js');
const PAGE = resolve(ROOT, htmlArg || 'index.html');
const OUT = resolve(ROOT, outArg || 'aurelia.html');

const IMPORT_RE = /^[ \t]*import\s*\{([\s\S]*?)\}\s*from\s*['"]([^'"]+)['"];?[ \t]*$/gm;
const EXPORT_RE = /^export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;

const idOf = (file) => '__m_' + relative(ROOT, file).replace(/[^\w]/g, '_');

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
      throw new Error('circular import: ' + [...stack, file].map((f) => relative(ROOT, f)).join(' -> '));
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
        throw new Error(`${relative(ROOT, m.file)} imports "${orig}" which ${relative(ROOT, imp.file)} does not export`);
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

// Walk the import graph from the entry — nothing unreferenced gets bundled.
const modules = new Map();
const discover = async (file) => {
  if (modules.has(file)) return;
  const m = await parse(file);
  modules.set(file, m);
  for (const imp of m.imports) await discover(imp.file);
};
await discover(ENTRY);

const sorted = order(modules, ENTRY);
const bundle = sorted.map((m) => emit(m, modules)).join('\n\n');
let page = await readFile(PAGE, 'utf8');
const banner = '<!-- Built by tools/build-standalone.mjs — edit the sources, not this file. -->';

// Inline any stylesheet the page links from this repo.
const linkRe = /<link rel="stylesheet" href="([^"]+)"\s*\/?>/g;
for (const m of [...page.matchAll(linkRe)]) {
  const css = await readFile(resolve(dirname(PAGE), m[1]), 'utf8');
  page = page.replace(m[0], `<style>\n${css}\n</style>`);
}

// Replace the module entry point with the bundle. Pages that already inline
// their bootstrap keep it and just get the modules prepended.
const scriptRe = /<script type="module" src="([^"]+)"><\/script>/;
if (scriptRe.test(page)) {
  page = page.replace(scriptRe, `<script type="module">\n${bundle}\n</script>`);
} else {
  // The page carries its own inline bootstrap: swap each of its imports for a
  // binding into the corresponding bundled module.
  const inline = page.match(/<script type="module">([\s\S]*?)<\/script>/);
  if (!inline) throw new Error('no module script found in ' + relative(ROOT, PAGE));
  let body = inline[1];
  const binds = [];
  for (const m of [...body.matchAll(IMPORT_RE)]) {
    const target = resolve(dirname(PAGE), m[2]);
    const dep = modules.get(target);
    if (!dep) throw new Error(`page imports ${m[2]}, which is not in the bundle`);
    const names = m[1].split(',').map((n) => n.trim()).filter(Boolean).map((n) => {
      const [orig, alias] = n.split(/\s+as\s+/).map((x) => x.trim());
      if (!dep.exports.includes(orig)) {
        throw new Error(`page imports "${orig}", which ${relative(ROOT, target)} does not export`);
      }
      return alias ? `${orig}: ${alias}` : orig;
    });
    binds.push(`const { ${names.join(', ')} } = ${idOf(target)};`);
  }
  body = body.replace(IMPORT_RE, '');
  page = page.replace(inline[0],
    `<script type="module">\n${bundle}\n\n/* ===== page bootstrap ===== */\n${binds.join('\n')}\n${body}\n</script>`);
}
page = page.replace('<title>', banner + '\n<title>');

if (/<link rel="stylesheet"|<script type="module" src=/.test(page)) {
  throw new Error('inlining failed: the page still links external assets');
}

await writeFile(OUT, page);
console.log(`${relative(ROOT, OUT)}  —  ${sorted.length} modules, ${(page.length / 1024).toFixed(0)} KB`);
