#!/usr/bin/env node
// Rewrites `@default(uuid(...))`, `@default(cuid(...))`, `@default(ulid())` and `@default(nanoid(...))`
// to `@onCreate(...)` in the Prisma 8 schema files named on the command line. The call is kept as
// written; string literals and `//` comments are left unchanged. A file without the `// use prisma-8` directive (or the
// older `// use prisma-next`) is left unchanged.
import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

const CLIENT_FUNCTION_IN_DEFAULT = /@default\((\s*(?:uuid|cuid|ulid|nanoid)\s*\([^()]*\)\s*)\)/g;
// The directive rule contract emit uses, copied from isPrismaNextSchema in
// packages/1-framework/2-authoring/psl-parser/src/schema-directive.ts; this script ships standalone.
const PRISMA8_DIRECTIVE = /^(\s*\/\/ *use +)(prisma-8|prisma-next)( *)(?!\S)/;

/** The line cut into code, string literals and a trailing `//` comment, with only the code to rewrite. */
function spansOf(line) {
  const spans = [];
  let codeStart = 0;
  let index = 0;
  while (index < line.length) {
    if (line[index] === '/' && line[index + 1] === '/') break;
    if (line[index] !== '"') {
      index += 1;
      continue;
    }
    spans.push({ text: line.slice(codeStart, index), code: true });
    let close = index + 1;
    while (close < line.length && line[close] !== '"') close += line[close] === '\\' ? 2 : 1;
    spans.push({ text: line.slice(index, close + 1), code: false });
    index = close + 1;
    codeStart = index;
  }
  spans.push({ text: line.slice(codeStart, index), code: true });
  spans.push({ text: line.slice(index), code: false });
  return spans;
}

function rewrite(text) {
  let count = 0;
  const lines = text.split('\n').map((line) =>
    spansOf(line)
      .map(({ text: span, code }) =>
        code
          ? span.replace(CLIENT_FUNCTION_IN_DEFAULT, (_match, call) => {
              count += 1;
              return `@onCreate(${call})`;
            })
          : span,
      )
      .join(''),
  );
  return { text: lines.join('\n'), count };
}

const files = process.argv.slice(2);
if (files.length === 0) {
  process.stderr.write('Usage: node rewrite-default-generators.mjs <schema.prisma>...\n');
  process.exit(1);
}

const texts = new Map();
for (const file of files) {
  try {
    texts.set(file, readFileSync(file, 'utf8'));
  } catch {
    process.stderr.write(`${file}: cannot be read; no file was changed.\n`);
    process.exit(1);
  }
}

for (const [file, text] of texts) {
  if (!PRISMA8_DIRECTIVE.test(text)) {
    process.stdout.write(
      `${file}: has no "// use prisma-8" directive, so it is not a Prisma 8 schema; left unchanged. A Prisma 7 schema keeps @default(uuid()).\n`,
    );
    continue;
  }
  const rewritten = rewrite(text);
  if (rewritten.count === 0) {
    process.stdout.write(`${file}: no client function in @default; left unchanged.\n`);
    continue;
  }
  writeFileSync(file, rewritten.text);
  process.stdout.write(
    `${file}: rewrote ${rewritten.count} @default ${rewritten.count === 1 ? 'call' : 'calls'} to @onCreate.\n`,
  );
}
