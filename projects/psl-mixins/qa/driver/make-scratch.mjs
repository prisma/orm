import { cpSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , targetDir, nodeModules] = process.argv;
if (nodeModules === undefined) {
  console.error(
    'usage: node make-scratch.mjs <target dir> <node_modules of examples/prisma-8-demo>',
  );
  process.exit(1);
}
const here = dirname(fileURLToPath(import.meta.url));
const target = resolve(targetDir);
const { files } = JSON.parse(readFileSync(resolve(here, 'scratch.json'), 'utf8'));
const projects = new Set();
for (const [path, lines] of Object.entries(files)) {
  const file = resolve(target, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, lines.join('\n'));
  projects.add(dirname(file));
}
for (const project of projects) symlinkSync(resolve(nodeModules), resolve(project, 'node_modules'));
for (const helper of ['dev-db.mjs', 'query-db.mjs']) {
  cpSync(resolve(here, helper), resolve(target, 'db', helper));
}
for (const copy of ['after-mixin-rename', 'after-field-rename']) {
  cpSync(resolve(target, 'lsp/project'), resolve(target, 'lsp', copy), {
    recursive: true,
    verbatimSymlinks: true,
  });
}
for (const out of ['out', 'lsp/out']) mkdirSync(resolve(target, out), { recursive: true });
console.log(
  `wrote ${Object.keys(files).length} files in ${projects.size} projects under ${target}`,
);
