#!/usr/bin/env node
// Usage: node scripts/check-snapshot-types.mjs [<repo root>] [<folder under it>]
// Only packages/ is checked: snapshots elsewhere include states written by earlier emitters and frozen upgrade-test inputs.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const ts = createRequire(join(scriptRoot, 'package.json'))('typescript');

const SNAPSHOT_DTS = /(^|\/)migrations\/snapshots\/[^/]+\/contract\.d\.ts$/;

export function snapshotFiles(root, under = 'packages') {
  return execFileSync('git', ['ls-files', '--', `${under}/*contract.d.ts`], {
    cwd: root,
    encoding: 'utf-8',
  })
    .split('\n')
    .filter((file) => SNAPSHOT_DTS.test(file));
}

function projectFolderOf(file) {
  let folder = dirname(file);
  while (!existsSync(join(folder, 'tsconfig.json'))) {
    const parent = dirname(folder);
    if (parent === folder) {
      throw new Error(`check-snapshot-types: no tsconfig.json above ${file}`);
    }
    folder = parent;
  }
  return folder;
}

function compilerOptionsOf(folder) {
  const configPath = join(folder, 'tsconfig.json');
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error) {
    throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'));
  }
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, folder, undefined, configPath);
  return { ...parsed.options, skipLibCheck: false, noEmit: true };
}

export function snapshotDiagnostics(root, under = 'packages') {
  const files = snapshotFiles(root, under);
  if (files.length === 0) {
    return [`${under}/: no snapshot declaration files found, so nothing was checked`];
  }
  const byProject = new Map();
  for (const file of files) {
    const absolute = resolve(root, file);
    const folder = projectFolderOf(absolute);
    byProject.set(folder, [...(byProject.get(folder) ?? []), absolute]);
  }

  const problems = [];
  for (const [folder, files] of byProject) {
    const program = ts.createProgram(files, compilerOptionsOf(folder));
    for (const file of files) {
      const source = program.getSourceFile(file);
      const diagnostics = [
        ...program.getSyntacticDiagnostics(source),
        ...program.getSemanticDiagnostics(source),
      ];
      for (const diagnostic of diagnostics) {
        const { line } = source.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
        const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ');
        problems.push(`${file.slice(root.length + 1)}:${line + 1}: ${message}`);
      }
    }
  }
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] ?? scriptRoot);
  const under = process.argv[3] ?? 'packages';
  const problems = snapshotDiagnostics(root, under);
  if (problems.length > 0) {
    console.error(`check-snapshot-types: ${problems.length} problem(s) in snapshot declarations:`);
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }
  console.log(
    `check-snapshot-types: ${snapshotFiles(root, under).length} snapshot declarations under ${under}/ typecheck.`,
  );
}
