#!/usr/bin/env node
/**
 * Typechecks every committed contract snapshot declaration file
 * (`**\/migrations/snapshots/<hash>/contract.d.ts`) with its imports resolved.
 *
 * The repository's TypeScript settings skip checking declaration files, so an
 * import in a snapshot that resolves to nothing turns its types into `any` with
 * no error. This check compiles each snapshot under the TypeScript settings of
 * the package that holds it, with declaration files checked, and fails on any
 * diagnostic in a snapshot file, an unresolved import included.
 *
 * It checks the snapshots under `packages/`, which the workspace's own
 * regeneration keeps current. Snapshots elsewhere include historical states
 * written by earlier versions of the emitter, and inputs frozen for upgrade
 * tests, which are not expected to typecheck against today's packages.
 *
 * Needs a prior `pnpm build`: snapshots import the packages' built types. The
 * CI lint job runs it through `scripts/check-snapshot-types.test.mjs` in
 * `pnpm test:scripts`, after its build step. Finding no snapshot is a failure.
 *
 * Usage: node scripts/check-snapshot-types.mjs [<repo root>] [<folder under it>]
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const ts = createRequire(join(scriptRoot, 'package.json'))('typescript');

const SNAPSHOT_DTS = /(^|\/)migrations\/snapshots\/[^/]+\/contract\.d\.ts$/;

/** The committed snapshot declaration files under `root`, relative to it. */
export function snapshotFiles(root, under = 'packages') {
  return execFileSync('git', ['ls-files', '--', `${under}/*contract.d.ts`], {
    cwd: root,
    encoding: 'utf-8',
  })
    .split('\n')
    .filter((file) => SNAPSHOT_DTS.test(file));
}

/** The nearest folder above `file` that holds a `tsconfig.json`. */
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

/** Every diagnostic in a snapshot file under `root`, formatted one per line. */
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
