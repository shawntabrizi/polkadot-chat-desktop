#!/usr/bin/env node
// Token lint for the renderer (M5 step 10; .refs/polkadot-design-system SKILL.md §3, §7, §14).
// App code writes the design system's names; the stock Tailwind and shadcn
// spellings compile (stock components are built from them), so only a lint
// can keep them out. Scans src/renderer outside components/ui/ (installed
// shadcn, never edited), theme/ (the generated bundle, read-only) and
// lib/cn.ts (copied from the skill; its comments name the stock classes it merges).
// Exit 1 with one line per hit.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const renderer = join(root, 'src/renderer');
const SKIP = [join(renderer, 'components/ui'), join(renderer, 'theme'), join(renderer, 'lib/cn.ts')];
const SCANNED = /\.(tsx?|css|html)$/;

/** [rule, pattern, applies to file] */
const RULES = [
  ['inline style (use classes)', /style=\{\{/, file => /\.tsx?$/.test(file)],
  ['raw Tailwind colour (use a semantic token)', /\b(?:bg|text|border|ring|outline|fill|stroke|from|via|to|divide)-(?:(?:white|black)\b|(?:gray|zinc|neutral|slate|blue|red|green)-)/, () => true],
  ['dark: variant (tokens re-resolve per theme)', /\bdark:/, () => true],
  ['font-bold (headings are semibold)', /\bfont-bold\b/, () => true],
  ['stock type step (use a named style: text-body-m, text-label-l, …)', /\btext-(?:xs|sm|base|lg|[2-9]?xl)\b/, () => true],
  ['stock radius (use rounded-container / nested / medium / small / full)', /\brounded(?:-[a-z]{1,2})?-(?:md|lg|[2-9]?xl)\b/, () => true],
  ['leading-* (line height belongs to the type style)', /\bleading-[\w[]/, () => true],
  ['border-gray (bare border is already --stroke-primary)', /\bborder-gray/, () => true],
  ['hex colour literal', /#[0-9a-f]{6}\b/i, file => file.endsWith('.tsx')],
  [
    'shadcn role name (components/ui only)',
    /\b(?:bg|text|border|ring)-(?:card|popover|muted|muted-foreground|foreground|background|input|primary|secondary|accent|destructive)(?:-foreground)?\b(?!-)/,
    () => true,
  ],
];

const files = [];
const walk = dir => {
  if (SKIP.includes(dir)) return;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (SKIP.includes(path)) continue;
    if (statSync(path).isDirectory()) walk(path);
    else if (SCANNED.test(name)) files.push(path);
  }
};
walk(renderer);

const hits = [];
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, index) => {
    for (const [rule, pattern, applies] of RULES) {
      if (applies(file) && pattern.test(line)) hits.push(`${relative(root, file)}:${index + 1}: ${rule}\n    ${line.trim()}`);
    }
  });
}

if (hits.length > 0) {
  console.error(hits.join('\n'));
  console.error(`check:tokens: ${hits.length} problem(s) in ${files.length} files`);
  process.exit(1);
}
console.log(`check:tokens: clean (${files.length} files)`);
