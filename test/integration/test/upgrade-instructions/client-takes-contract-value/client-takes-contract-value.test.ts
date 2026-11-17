import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { timeouts } from '@repo/test-utils';
import { dirname, join, relative } from 'pathe';
import ts from 'typescript';
import { afterAll, describe, expect, it } from 'vitest';
import { detectionPatterns } from '../guide-detections';

const SCRIPT_PATHS = {
  app: 'skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.18-to-8.0.0-rc.19/scripts/client-takes-contract-value/contract-from-json.ts',
  extension:
    'skills/prisma-8/upgrading/extension/upgrades/8.0.0-rc.18-to-8.0.0-rc.19/scripts/client-takes-contract-value/contract-from-json.ts',
} as const;

const GUIDE_PATHS = {
  app: 'skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.18-to-8.0.0-rc.19/instructions.md',
  extension:
    'skills/prisma-8/upgrading/extension/upgrades/8.0.0-rc.18-to-8.0.0-rc.19/instructions.md',
} as const;

type Audience = keyof typeof SCRIPT_PATHS;
type Tree = Record<string, string>;

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../../../../..');
const fixtures = join(here, 'fixtures');
const typescript = createRequire(import.meta.url).resolve('typescript');
const workDirs: string[] = [];

afterAll(() => {
  for (const dir of workDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function readTree(root: string, dir = root): Tree {
  const files: Tree = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) Object.assign(files, readTree(root, path));
    else files[relative(root, path)] = readFileSync(path, 'utf8');
  }
  return files;
}

function fixtureTree(fixture: string, side: 'before' | 'after'): Tree {
  return readTree(join(fixtures, fixture, side));
}

function writeProject(tree: Tree, links: Readonly<Record<string, string>> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'client-takes-contract-value-'));
  workDirs.push(root);
  for (const [path, content] of Object.entries(tree)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  for (const [path, target] of Object.entries(links)) symlinkSync(target, join(root, path));
  return root;
}

function runScript(audience: Audience, args: readonly string[]) {
  const result = spawnSync(process.execPath, [join(repoRoot, SCRIPT_PATHS[audience]), ...args], {
    encoding: 'utf8',
    env: { ...process.env, NODE_PATH: '' },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function runOn(tree: Tree, audience: Audience, options: readonly string[]) {
  const root = writeProject(tree);
  return { ...runScript(audience, [root, ...options]), tree: readTree(root) };
}

function run(tree: Tree, audience: Audience) {
  return runOn(tree, audience, ['--typescript', typescript]);
}

const moved = (paths: readonly string[]) =>
  paths.map((path) => `${path}: moved to contractFromJson\n`).join('');

const notExported = (path: string) =>
  `${path}: moved to contractFromJson; contract is not exported, because the module has a default export (a Worker treats every named export of its entry module as an entrypoint); a module that needs the value gets it from a separate module\n`;

describe.each(['app', 'extension'] as const)('the %s script', (audience) => {
  it('moves each source file to a contract value and reports the test file it leaves', () => {
    expect(run(fixtureTree('app', 'before'), audience)).toEqual({
      status: 1,
      stdout:
        moved(['src/enums.ts', 'src/prisma/db.ts', 'src/query.ts', 'src/supabase.ts']) +
        notExported('src/worker.ts'),
      stderr:
        'test/test-db.ts: not moved, because it is a test file; import the contract value from the module that creates the client\n',
      tree: fixtureTree('app', 'after'),
    });
  });

  it('moves calls with comments, default-as imports, nested objects, a default export and a destructured contract', () => {
    expect(run(fixtureTree('shapes', 'before'), audience)).toEqual({
      status: 0,
      stdout:
        notExported('migrations/app/20261007T1630_backfill/migration.ts') +
        moved(['src/accessor.ts', 'src/comment.ts', 'src/default-as.ts']) +
        notExported('src/default-export.ts') +
        notExported('src/default-reexport.ts') +
        moved([
          'src/inner-destructure.ts',
          'src/members.ts',
          'src/nested-object.ts',
          'src/only-contract.ts',
          'src/value-with-comma.ts',
        ]),
      stderr: '',
      tree: fixtureTree('shapes', 'after'),
    });
  });

  it.each([
    ['double quotes', (content: string) => content.replaceAll("'", '"')],
    ['no semicolons', (content: string) => content.replace(/;$/gm, '')],
    ['CRLF line endings', (content: string) => content.replaceAll('\n', '\r\n')],
  ])('keeps the style of a file with %s', (_name, style) => {
    const before = { 'src/db.ts': style(fixtureTree('app', 'before')['src/prisma/db.ts'] ?? '') };
    const after = { 'src/db.ts': style(fixtureTree('app', 'after')['src/prisma/db.ts'] ?? '') };
    expect(run(before, audience)).toEqual({
      status: 0,
      stdout: moved(['src/db.ts']),
      stderr: '',
      tree: after,
    });
  });

  it('changes nothing in a project already moved', () => {
    const { 'test/test-db.ts': _test, ...after } = fixtureTree('app', 'after');
    expect(run(after, audience)).toEqual({ status: 0, stdout: '', stderr: '', tree: after });
  });

  it('refuses each file it cannot move safely, changes none of them, and exits 1', () => {
    expect(run(fixtureTree('refused', 'before'), audience)).toEqual({
      status: 1,
      stdout: '',
      stderr: [
        'src/array-hole.ts: not moved, because it already has a binding named contract (line 6); rename that binding and run the script again',
        'src/binding.ts: not moved, because it already has a binding named contract (line 5); rename that binding and run the script again',
        'src/client-in-function.ts: not moved, because its contractJson value uses contract, which is a parameter or local binding where the client is created, not a value the top of the file can read; pass contract: contractFromJson<OrmContractOf<C>>(contract.__cmp.contractJson) to the call instead of contractJson, and import contractFromJson from @prisma/orm-postgres/static',
        'src/destructured.ts: not moved, because it already has a binding named contract (line 7); rename that binding and run the script again',
        'src/enum.ts: not moved, because it already has a binding named contract (line 5); rename that binding and run the script again',
        'src/import-equals.ts: not moved, because it already has a binding named contract (line 5); rename that binding and run the script again',
        'src/inner-binding.ts: not moved, because it already has a binding named contract (line 6); rename that binding and run the script again',
        'src/json-named-contract.ts: not moved, because it already has a binding named contract (line 3); rename that binding and run the script again',
        'src/parameter.ts: not moved, because it already has a binding named contract (line 7); rename that binding and run the script again',
        'src/reexport-destructured.ts: not moved, because it exports contract in an export statement (line 6); remove contract from that statement and run the script again',
        'src/reexport.ts: not moved, because it exports contract in an export statement (line 5); remove contract from that statement and run the script again',
        'src/shadow-parameter.ts: not moved, because its contractJson value uses cj, which is a parameter or local binding where the client is created, not a value the top of the file can read; pass contract: contractFromJson<Contract>(cj) to the call instead of contractJson, and import contractFromJson from @prisma/orm-postgres/static',
        'src/two-contracts.ts: not moved, because its clients use different contracts; give each its own contractFromJson value',
        'src/unreadable.ts: not moved, because it passes contractJson to a client in a form the script cannot read',
        'src/value-uses-local.ts: not moved, because its contractJson value uses contractPath, which the file declares after its imports; declare the contract value after contractPath by hand',
        '',
      ].join('\n'),
      tree: fixtureTree('refused', 'before'),
    });
  });

  it('skips a dangling link and a link back to a parent directory', () => {
    const before = { 'src/db.ts': fixtureTree('app', 'before')['src/prisma/db.ts'] ?? '' };
    const root = writeProject(before, { 'src/.#db.ts': 'missing.ts', 'src/loop': '..' });
    expect(runScript(audience, [root, '--typescript', typescript])).toEqual({
      status: 0,
      stdout: moved(['src/db.ts']),
      stderr: '',
    });
  });

  it('refuses an unknown option, a missing --typescript path and a root that is not a directory', () => {
    const root = writeProject({});
    const missing = join(root, 'missing');
    const usage =
      'Usage: node contract-from-json.ts [project-root] [--typescript <path to the typescript package>]\n';
    expect(
      [['--help'], [root, '--typescript'], [missing, '--typescript', typescript]].map((args) =>
        runScript(audience, args),
      ),
    ).toEqual([
      { status: 1, stdout: '', stderr: `--help: unknown option\n${usage}` },
      {
        status: 1,
        stdout: '',
        stderr: `--typescript: needs the path to the typescript package\n${usage}`,
      },
      { status: 1, stdout: '', stderr: `${missing}: not a directory\n${usage}` },
    ]);
  });

  it('changes nothing and exits 1 when the project has no TypeScript', () => {
    const before = fixtureTree('app', 'before');
    const result = runOn(before, audience, []);
    expect({ ...result, stderr: result.stderr.replace(/ in \S+\./, ' in <root>.') }).toEqual({
      status: 1,
      stdout: '',
      stderr:
        'TypeScript is not installed in <root>. Install it (for example pnpm add -D typescript) and run the script again, or move each client by hand as the guide describes. No file was changed.\n',
      tree: before,
    });
  });
});

const STUB_CONTRACT_DIRS = ['src', 'src/prisma', 'migrations/snapshots/95e9bd41'];

/** The type errors in `files` of `tree`, checked against small local declarations of the facade entries the fixtures import. */
function typeErrors(tree: Tree, files: readonly string[]): string[] {
  const stubs = readTree(join(fixtures, 'typecheck-stubs'));
  const contractStubs = Object.fromEntries(
    STUB_CONTRACT_DIRS.flatMap((dir) => [
      [`${dir}/contract.d.ts`, stubs['contract.d.ts'] ?? ''],
      [`${dir}/contract.json`, stubs['contract.json'] ?? ''],
    ]),
  );
  const root = writeProject({
    ...tree,
    ...contractStubs,
    'facades.d.ts': stubs['facades.d.ts'] ?? '',
  });
  const program = ts.createProgram(
    [...files, 'facades.d.ts'].map((file) => join(root, file)),
    {
      noEmit: true,
      strict: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      resolveJsonModule: true,
      lib: ['lib.esnext.d.ts'],
      skipLibCheck: true,
      types: ['node'],
      typeRoots: [join(repoRoot, 'node_modules/@types')],
    },
  );
  return ts
    .getPreEmitDiagnostics(program)
    .map(
      (diagnostic) =>
        `${relative(root, diagnostic.file?.fileName ?? root)}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`,
    );
}

const MOVED_FILES = {
  app: ['src/enums.ts', 'src/prisma/db.ts', 'src/query.ts', 'src/supabase.ts', 'src/worker.ts'],
  shapes: [
    'migrations/app/20261007T1630_backfill/migration.ts',
    'src/accessor.ts',
    'src/comment.ts',
    'src/default-as.ts',
    'src/default-export.ts',
    'src/default-reexport.ts',
    'src/inner-destructure.ts',
    'src/members.ts',
    'src/nested-object.ts',
    'src/only-contract.ts',
    'src/value-with-comma.ts',
  ],
} as const;

describe('the files the script writes', () => {
  it.each(['app', 'shapes'] as const)(
    'typecheck in the %s fixture',
    (fixture) => {
      expect(typeErrors(fixtureTree(fixture, 'after'), MOVED_FILES[fixture])).toEqual([]);
    },
    timeouts.typeScriptCompilation,
  );

  it.each(['app', 'shapes'] as const)(
    'did not typecheck with contractJson before the script ran in the %s fixture',
    (fixture) => {
      const failing = new Set(
        typeErrors(fixtureTree(fixture, 'before'), MOVED_FILES[fixture])
          .filter((error) => error.includes("'contractJson'"))
          .map((error) => error.split(':')[0]),
      );
      expect(MOVED_FILES[fixture].filter((file) => !failing.has(file))).toEqual([]);
    },
    timeouts.typeScriptCompilation,
  );
});

function scriptDetection(audience: Audience): RegExp {
  const script = readFileSync(join(repoRoot, SCRIPT_PATHS[audience]), 'utf8');
  const literal = /const DETECTION =\s*\/(.*)\/;\n/.exec(script)?.[1];
  if (literal === undefined) throw new Error(`${SCRIPT_PATHS[audience]} has no DETECTION`);
  return new RegExp(literal);
}

/** The first detection pattern of the guide's entry, which matches the call the script moves. */
function detection(audience: Audience): RegExp {
  const [pattern] = detectionPatterns(GUIDE_PATHS[audience], 'client-takes-contract-value');
  if (pattern === undefined) throw new Error(`${GUIDE_PATHS[audience]} has no detection pattern`);
  return pattern;
}

describe.each(['app', 'extension'] as const)('the %s detection', (audience) => {
  const detects = (content: string) => detection(audience).test(content);

  it('is the pattern the script uses', () => {
    expect(scriptDetection(audience).source).toBe(detection(audience).source);
  });

  it.each([
    ['a one-line call', 'export const db = postgres<Contract>({ contractJson, url });'],
    ['a multi-line call', 'export const db = postgres<Contract>({\n  contractJson,\n  url,\n});'],
    ['an explicit property', 'sqlite({ path, contractJson: json })'],
    [
      'a nested object before it',
      'postgres<Contract>({ cursor: { batchSize: 100 }, contractJson })',
    ],
    ['a static entry', 'mongoStatic<Contract>({ contractJson }).enums'],
    ['the query builder', 'mongoQuery<TContract>({ contractJson: contract })'],
    ['Supabase', 'supabase<Contract>({ url, contractJson, jwtSecret })'],
    ['a nested type argument', 'postgres<OrmContractOf<Contract>>({ contractJson, url })'],
  ])('finds %s', (_name, content) => {
    expect(detects(content)).toBe(true);
  });

  it.each([
    ['the new form', 'postgres({ contract: contractFromJson<Contract>(contractJson), url })'],
    ['a contract value', 'export const db = postgres({ contract, url });'],
    ['another function', 'withPostgresPort({ contractJson })'],
    ['a method of the same name', 'client.postgres({ contractJson })'],
    ['a control client option', 'client.dbInit({ contract: contractJson })'],
  ])('skips %s', (_name, content) => {
    expect(detects(content)).toBe(false);
  });
});
