#!/usr/bin/env node
/**
 * The old `prisma-next` name does not come back.
 *
 * Prisma 8 publishes 17 packages under `@prisma/*`, its repository is
 * `prisma/orm`, and its examples read `prisma-8-*`. The working name survives
 * only where it is a record of what really shipped, a pointer into the old
 * repository, a third party's package name, or a test proving the retired name
 * stays gone. Every other occurrence is a mistake, and this check is what keeps
 * it from accumulating again.
 *
 * There is no threshold and no count. Each allowance below is a category with
 * a reason.
 *
 * Exit codes:
 *   0 — no disallowed occurrence
 *   1 — at least one, named by file and line
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const GIT_ROOT = process.cwd();

const LEGACY = 'prisma-next';

/** Files that carry the retired name only to prove it stays gone, this check included. */
const RETIREMENT_PROOFS = new Set([
  'scripts/lint-legacy-name.mjs',
  'packages/1-framework/3-tooling/cli/src/commands/init/skill-sources.ts',
  'packages/1-framework/3-tooling/cli/test/commands/init/skill-sources.test.ts',
  'packages/1-framework/3-tooling/cli/test/orm/init-scaffold.test.ts',
  'packages/1-framework/1-core/errors/test/next-actions.test.ts',
  'packages/1-framework/3-tooling/migration/test/next-actions.test.ts',
  'test/integration/test/packaging/facade-tarball.test.ts',
  'packages/9-public/@prisma/orm-target-postgres/test/cross-shell-tarball.test.ts',
  'test/integration/test/cli.init-skill-distribution.integration.test.ts',
]);

/** Files that read the retired name so projects and shells set up by earlier releases keep working. */
const COMPATIBILITY_SITES = new Set([
  'packages/1-framework/2-authoring/psl-parser/src/schema-directive.ts',
  'packages/1-framework/2-authoring/psl-parser/test/schema-directive.test.ts',
  'packages/1-framework/3-tooling/language-server/test/server.test.ts',
  'packages/1-framework/3-tooling/cli-telemetry/src/gating.ts',
  'packages/1-framework/3-tooling/cli-telemetry/test/gating.test.ts',
  'docs/Telemetry.md',
]);

/** Files that name the retired directive spelling because they rename it into the current one. */
const DIRECTIVE_RENAME_CODEMODS = new Set([
  'upgrade-instructions/pending/multifile-psl/app/instructions.md',
  'upgrade-instructions/pending/multifile-psl/app/scripts/add-use-prisma-8-directive.mjs',
]);

/**
 * An occurrence that is allowed, with the reason. Each returns true when it
 * recognises the occurrence as its own kind.
 *
 * Allowances are tested against a single occurrence — the text before and
 * after it — rather than the whole line, because one line can hold both an
 * allowed and a disallowed use. `prisma-next contract emit` inside a comment
 * that also names `@internal/cli` must fail on the second without the first
 * excusing it.
 *
 * Order does not matter — an occurrence needs only one allowance to pass.
 */
const ALLOWED = [
  {
    why: 'a dated record of past work — the changelog, the release notes, the ADRs, the shipped upgrade instructions, the gotcha logs, the framework-gaps review, the `projects/` and `drive/` write-ups, and committed migration steps and their content-addressed contract snapshots. Each says what was true, decided, or observed at a time when the old name was the name; rewriting one would misreport it (or break its hash)',
    matches: (relPath) =>
      /^(CHANGELOG\.md|docs\/releases\/v[^/]*\.md|docs\/architecture docs\/adrs\/|docs\/reference\/framework-gaps\.md|skills\/prisma-8\/upgrading\/|projects\/|drive\/)/.test(
        relPath,
      ) ||
      /(^|\/)gotchas\.md$/.test(relPath) ||
      /\/migrations\/(?:snapshots|app)\//.test(relPath),
  },
  {
    why: 'a link pinned to something in the old repository — a pull request, issue, commit or release by number, or a file at a released tag — a Linear ticket whose URL carries a generated slug, or a link to an ADR whose filename carries the old name. Each names a thing that exists there and only there, so repointing would send the reader somewhere else entirely',
    matches: (relPath, line, before, after) =>
      (/prisma\/$/.test(before) &&
        /^\/(?:pull|issues|commit|compare|releases|blob\/v[\d.]|tree\/v[\d.])\b/.test(after)) ||
      /linear\.app\/[^\s)]*$/.test(before) ||
      /adrs\/ADR(?:%20| )\d+(?:%20| )-(?:%20| )$/.test(before),
  },
  {
    why: 'a third party’s package name — `@cipherstash/prisma-next` is published under that name and only that name',
    matches: (relPath, line, before) => /@cipherstash\/$/.test(before),
  },
  {
    why: 'the retired name kept only to prove it stays gone — this check, the list of skill directories `init` deletes from older projects, and the tests asserting that no `prisma-next` bin or skill directory is installed any more',
    matches: (relPath) => RETIREMENT_PROOFS.has(relPath),
  },
  {
    why: 'compatibility with what earlier releases wrote into user projects and shells — the language server still serves a schema headed `// use prisma-next` (and formatting renames it), and the telemetry opt-out still honours `PRISMA_NEXT_DISABLE_TELEMETRY`',
    matches: (relPath) => COMPATIBILITY_SITES.has(relPath),
  },
  {
    why: 'the codemod that renames a schema headed `// use prisma-next` to the current directive, and its instructions — both must name the retired spelling to find it',
    matches: (relPath) => DIRECTIVE_RENAME_CODEMODS.has(relPath),
  },
];

const SKIP_PATH = /(^|\/)(node_modules|dist|dist-tsc|dist-tsc-prod|coverage|\.turbo)\//;
const BINARY = /\.(png|jpg|jpeg|gif|ico|svg|woff2?|ttf|eot|pdf|zip|tgz|wasm)$/i;

export function trackedFiles(scanDir) {
  return execFileSync('git', ['ls-files', '-z'], {
    cwd: scanDir,
    encoding: 'utf-8',
    stdio: 'pipe',
    maxBuffer: 256 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean)
    .filter((relPath) => !SKIP_PATH.test(relPath) && !BINARY.test(relPath));
}

/**
 * The allowance covering one occurrence, or undefined when none does.
 *
 * `at` is the index of the occurrence within `line`; it defaults to the first,
 * which is what a caller checking a single-occurrence string wants.
 */
export function allowanceFor(relPath, line, at = line.indexOf(LEGACY)) {
  const before = line.slice(0, at);
  const after = line.slice(at + LEGACY.length);
  return ALLOWED.find((allowance) => allowance.matches(relPath, line, before, after));
}

/** Every occurrence in `scanDir` that no allowance covers. */
export function findViolations(scanDir, files = trackedFiles(scanDir)) {
  const violations = [];
  for (const relPath of files) {
    let content;
    try {
      content = readFileSync(join(scanDir, relPath), 'utf-8');
    } catch {
      continue;
    }
    if (!content.includes(LEGACY)) continue;
    content.split('\n').forEach((line, index) => {
      for (let at = line.indexOf(LEGACY); at !== -1; at = line.indexOf(LEGACY, at + 1)) {
        if (allowanceFor(relPath, line, at) !== undefined) continue;
        violations.push({ file: relPath, line: index + 1, column: at + 1, text: line.trim() });
        return;
      }
    });
  }
  return violations;
}

export function main(scanDir = GIT_ROOT) {
  const violations = findViolations(scanDir);
  if (violations.length === 0) {
    console.log(`No disallowed \`${LEGACY}\` occurrence.`);
    return 0;
  }

  console.error(`${violations.length} disallowed \`${LEGACY}\` occurrence(s):\n`);
  for (const violation of violations.slice(0, 40)) {
    console.error(`  ${violation.file}:${violation.line}: ${violation.text.slice(0, 140)}`);
  }
  if (violations.length > 40) console.error(`  … and ${violations.length - 40} more`);
  console.error(
    '\nPrisma 8 publishes under `@prisma/*` from `prisma/orm`. The old name is\n' +
      'allowed only where it is a record of what shipped, a link into the old\n' +
      "repository by number, a third party's package name, or a test that the\n" +
      'retired name stays gone:\n',
  );
  for (const allowance of ALLOWED) console.error(`  - ${allowance.why}\n`);
  return 1;
}

if (process.argv[1] === import.meta.filename) process.exit(main());
