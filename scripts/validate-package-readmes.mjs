#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

function listSrcParents() {
  let out;
  try {
    out = execSync("find packages -type d -name src | sed 's|/src$||'", { encoding: 'utf8' });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Failed to list package source directories: ${message}\n`);
    process.exit(1);
  }
  return out
    .split(/\r?\n/)
    .filter(Boolean)
    .filter((p) => !/coverage|\.turbo|node_modules/.test(p));
}

const dirs = listSrcParents();
const errors = [];
const warnings = [];

for (const dir of dirs) {
  const readme = `${dir}/README.md`;
  if (!existsSync(readme)) {
    errors.push(`${dir}: missing README.md`);
    continue;
  }
  const txt = readFileSync(readme, 'utf8');
  if (!/^#\s+/m.test(txt)) warnings.push(`${dir}: README missing top-level title`);
  if (!/^##\s+Responsibilities/m.test(txt))
    warnings.push(`${dir}: README missing 'Responsibilities' section`);
}

if (errors.length) {
  console.error(`README validation failed:\n${errors.map((e) => ` - ${e}`).join('\n')}`);
  if (warnings.length)
    console.warn(`README warnings:\n${warnings.map((w) => ` - ${w}`).join('\n')}`);
  process.exit(1);
} else if (warnings.length) {
  console.warn(`README warnings:\n${warnings.map((w) => ` - ${w}`).join('\n')}`);
  console.log('Package README presence validated.');
  process.exit(0);
} else {
  console.log('All package READMEs passed validation.');
}
