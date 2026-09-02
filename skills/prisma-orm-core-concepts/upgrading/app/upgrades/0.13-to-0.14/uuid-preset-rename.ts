/**
 * Renames uuid field presets (0.13 → 0.14):
 *   Before: field.uuid()       / field.id.uuidv4()       / field.id.uuidv7()
 *   After:  field.uuidString() / field.id.uuidv4String() / field.id.uuidv7String()
 *
 * Run from the project root: pnpm exec tsx <path-to-this-file>
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'pathe';

const replacements: Array<[RegExp, string]> = [
  [/\bfield\.id\.uuidv4\(\)/g, 'field.id.uuidv4String()'],
  [/\bfield\.id\.uuidv7\(\)/g, 'field.id.uuidv7String()'],
  [/\bfield\.uuid\(\)/g, 'field.uuidString()'],
];

const raw = execSync('git ls-files --cached --others --exclude-standard -- "*.ts"', {
  encoding: 'utf-8',
}).trim();

const files = raw.split('\n').filter(Boolean);
let changed = 0;
for (const file of files) {
  const abs = join(process.cwd(), file);
  let content: string;
  try {
    content = readFileSync(abs, 'utf-8');
  } catch {
    continue;
  }
  const original = content;
  for (const [pattern, replacement] of replacements) {
    content = content.replace(pattern, replacement);
  }
  if (content !== original) {
    writeFileSync(abs, content, 'utf-8');
    console.log(`updated ${file}`);
    changed++;
  }
}
console.log(`done — ${changed} file(s) updated`);
