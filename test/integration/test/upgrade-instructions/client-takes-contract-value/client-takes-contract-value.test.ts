import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'pathe';
import { afterAll, describe, expect, it } from 'vitest';

const SCRIPT_PATHS = {
  app: 'upgrade-instructions/pending/client-takes-contract-value/app/scripts/contract-from-json.ts',
  extension:
    'upgrade-instructions/pending/client-takes-contract-value/extension/scripts/contract-from-json.ts',
} as const;

const GUIDE_PATHS = {
  app: 'upgrade-instructions/pending/client-takes-contract-value/app/instructions.md',
  extension: 'upgrade-instructions/pending/client-takes-contract-value/extension/instructions.md',
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

function runOn(tree: Tree, audience: Audience, options: readonly string[]) {
  const root = mkdtempSync(join(tmpdir(), 'client-takes-contract-value-'));
  workDirs.push(root);
  for (const [path, content] of Object.entries(tree)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  const result = spawnSync(
    process.execPath,
    [join(repoRoot, SCRIPT_PATHS[audience]), root, ...options],
    { encoding: 'utf8' },
  );
  return {
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
    tree: readTree(root),
  };
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

  it('moves calls with comments, default-as imports, nested objects and a default export', () => {
    expect(run(fixtureTree('shapes', 'before'), audience)).toEqual({
      status: 0,
      stdout:
        moved(['src/comment.ts', 'src/default-as.ts']) +
        notExported('src/default-export.ts') +
        moved(['src/nested-object.ts', 'src/value-with-comma.ts']),
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
        'src/binding.ts: not moved, because it already has a binding named contract; rename that binding and run the script again',
        'src/json-named-contract.ts: not moved, because it already has a binding named contract; rename that binding and run the script again',
        'src/two-contracts.ts: not moved, because its clients use different contracts; give each its own contractFromJson value',
        'src/unreadable.ts: not moved, because it passes contractJson to a client in a form the script cannot read',
        'src/value-uses-local.ts: not moved, because its contractJson value uses contractPath, which the file declares after its imports; declare the contract value after contractPath by hand',
        '',
      ].join('\n'),
      tree: fixtureTree('refused', 'before'),
    });
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

function scriptDetection(audience: Audience): RegExp {
  const script = readFileSync(join(repoRoot, SCRIPT_PATHS[audience]), 'utf8');
  const literal = /const DETECTION =\s*\/(.*)\/;\n/.exec(script)?.[1];
  if (literal === undefined) throw new Error(`${SCRIPT_PATHS[audience]} has no DETECTION`);
  return new RegExp(literal);
}

function detection(audience: Audience): RegExp {
  const guide = readFileSync(join(repoRoot, GUIDE_PATHS[audience]), 'utf8');
  const pattern = /^ {8}- '(.*)'$/m.exec(guide)?.[1];
  if (pattern === undefined) throw new Error(`${GUIDE_PATHS[audience]} has no detection pattern`);
  return new RegExp(pattern.replaceAll("''", "'"));
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
