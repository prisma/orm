import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import type { SerializeContract } from '@internal/contract/hashing';
import { type MongoTargetContract, mongoTargetDescriptor } from '@internal/target-mongo/control';
import { dirname, join, relative } from 'pathe';
import ts from 'typescript';
import { afterAll, describe, expect, it } from 'vitest';
import { contract as aliased } from './fixtures/after/aliased';
import { contract as comments } from './fixtures/after/comments';
import { contract, fromHelpers } from './fixtures/after/contract';
import { contract as renamed } from './fixtures/after/renamed';

const SCRIPT_PATHS = {
  app: 'upgrade-instructions/pending/mongo-type-helpers/app/scripts/rewrite-mongo-field-types.ts',
  extension:
    'upgrade-instructions/pending/mongo-type-helpers/extension/scripts/rewrite-mongo-field-types.ts',
} as const;

const EXPECTED_STDOUT = [
  'aliased.ts: rewrote 3 field helper calls.',
  'binds-type.ts: line 6: field.objectId(): not rewritten, as type names another value here; write it as field.scalar(type.X(...)).',
  'comments-inside.ts: rewrote 1 field helper call.',
  'comments-inside.ts: line 8: field.objectId(/* primary key */): not rewritten, as a comment inside it would be lost; write it as field.scalar(type.X(...)).',
  "comments-inside.ts: line 9: field.scalar( 'mongo/string@1', // the title ): not rewritten, as a comment inside it would be lost; write it as field.scalar(type.X(...)).",
  'comments.ts: rewrote 2 field helper calls.',
  'constant.ts: rewrote 1 field helper call.',
  'constant.ts: line 9: field.scalar(CODEC): not rewritten, as its argument is the codec id "mongo/string@1"; write it as field.scalar(type.X(...)).',
  'contract.ts: rewrote 23 field helper calls.',
  'function-type.ts: line 3: field.objectId(): not rewritten, as type names another value here; write it as field.scalar(type.X(...)).',
  'local-field.ts: rewrote 1 field helper call.',
  "local-field.ts: line 7: field.date(): not rewritten, as the script cannot tell this field is the MongoDB builder's; write it as field.scalar(type.X(...)).",
  'mixed.ts: rewrote 2 field helper calls.',
  "param.ts: line 4: field.string(): not rewritten, as the script cannot tell this field is the MongoDB builder's; write it as field.scalar(type.X(...)).",
  'property.ts: rewrote 2 field helper calls.',
  "reexport.ts: line 3: field.objectId(): not rewritten, as the script cannot tell this field is the MongoDB builder's; write it as field.scalar(type.X(...)).",
  'renamed.ts: rewrote 4 field helper calls.',
  'required-property.cjs: line 4: fieldProp.objectId(): not rewritten, as no type is bound beside this field, so import type from @prisma/orm-mongo/contract-builder; write it as field.scalar(type.X(...)).',
  'required.cjs: rewrote 1 field helper call.',
  'rest.ts: rewrote 1 field helper call.',
  'shadowed.ts: rewrote 1 field helper call.',
  'shadowed.ts: line 7: field.string(): not rewritten, as type names another value here; write it as field.scalar(type.X(...)).',
  'unsupported.ts: rewrote 1 field helper call.',
  'unsupported.ts: line 9: field.scalar(\'geo/point@1\'): not rewritten, as codec "geo/point@1" has no type constructor here; write it as field.scalar(type.X(...)).',
  'unsupported.ts: line 10: field.vector({ typeParams: { length: dimensions(), other: 1 } }): not rewritten, as its arguments are not { typeParams: { length } }; write it as field.scalar(type.X(...)).',
  'Changed 13 files.',
  '',
].join('\n');

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../../../../..');
const fixturesDir = join(here, 'fixtures');
const workDirs: string[] = [];

afterAll(() => {
  for (const dir of workDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function copyBefore(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mongo-type-helpers-'));
  workDirs.push(dir);
  cpSync(join(fixturesDir, 'before'), dir, { recursive: true });
  return dir;
}

function filesOf(dir: string): Record<string, string> {
  return Object.fromEntries(
    readdirSync(dir).map((name) => [name, readFileSync(join(dir, name), 'utf8')]),
  );
}

function run(script: string, dir: string, args: readonly string[] = []) {
  const result = spawnSync(process.execPath, [join(repoRoot, script), ...args], {
    cwd: dir,
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe.each(Object.entries(SCRIPT_PATHS))(
  'the %s rewrite-mongo-field-types script',
  (_, script) => {
    it('rewrites every removed field helper in the files that import a MongoDB builder, and reports what it leaves', () => {
      const dir = copyBefore();
      const result = run(script, dir);
      expect({ status: result.status, stderr: result.stderr, stdout: result.stdout }).toEqual({
        status: 0,
        stderr: '',
        stdout: EXPECTED_STDOUT,
      });
      expect(filesOf(dir)).toEqual(filesOf(join(fixturesDir, 'after')));
    });

    it('exits 1 and changes nothing when neither the project nor the script folder has typescript', () => {
      const dir = copyBefore();
      cpSync(join(repoRoot, script), join(dir, 'rewrite.ts'));
      const result = spawnSync(process.execPath, ['rewrite.ts', 'contract.ts'], {
        cwd: dir,
        encoding: 'utf8',
      });
      expect({
        status: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
        contract: readFileSync(join(dir, 'contract.ts'), 'utf8'),
      }).toEqual({
        status: 1,
        stdout: '',
        stderr:
          'The script reads files with the "typescript" package, which this project does not have. Install it, for example with "pnpm add -D typescript", and run the script again.\n',
        contract: readFileSync(join(fixturesDir, 'before', 'contract.ts'), 'utf8'),
      });
    });

    it('leaves the files it rewrote unchanged on a second run', () => {
      const dir = copyBefore();
      run(script, dir);
      const second = run(script, dir, [
        'contract.ts',
        'aliased.ts',
        'renamed.ts',
        'comments.ts',
        'mixed.ts',
        'rest.ts',
        'required.cjs',
      ]);
      expect({ stdout: second.stdout, files: filesOf(dir) }).toEqual({
        stdout: 'Changed 0 files.\n',
        files: filesOf(join(fixturesDir, 'after')),
      });
    });
  },
);

const serializeContract: SerializeContract = (built) =>
  mongoTargetDescriptor.contractSerializer.serializeContract(built as MongoTargetContract);

describe('the rewritten contracts', () => {
  it.each([
    ['contract.contract.json', contract],
    ['contract.fromHelpers.json', fromHelpers],
    ['aliased.contract.json', aliased],
    ['renamed.contract.json', renamed],
    ['comments.contract.json', comments],
  ])('emit %s, the contract the removed helpers emitted', (emitted, built) => {
    expect(serializeContract(built)).toEqual(
      JSON.parse(readFileSync(join(fixturesDir, 'emitted', emitted), 'utf8')),
    );
  });
});

/** Where the innermost call holding `position` starts, as the script reports a call; `position` itself outside any call. */
function callStartOf(file: ts.SourceFile, position: number): number {
  let start = position;
  const visit = (node: ts.Node): void => {
    if (node.getStart(file) > position || node.end <= position) return;
    if (ts.isCallExpression(node)) start = node.getStart(file);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return start;
}

describe('the rewritten fixtures', () => {
  it('type-check, except on the lines the script reports it left', () => {
    const afterDir = join(fixturesDir, 'after');
    const config = ts.getParsedCommandLineOfConfigFile(
      join(here, '../../../tsconfig.json'),
      {},
      {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: () => {},
      },
    );
    const program = ts.createProgram(
      readdirSync(afterDir).map((name) => join(afterDir, name)),
      { ...config?.options, allowJs: true, checkJs: true, noEmit: true },
    );
    const failing = ts
      .getPreEmitDiagnostics(program)
      .flatMap(({ file, start }) =>
        file === undefined || start === undefined || !file.fileName.startsWith(afterDir)
          ? []
          : [
              `${relative(afterDir, file.fileName)}:${file.getLineAndCharacterOfPosition(callStartOf(file, start)).line + 1}`,
            ],
      );
    const reported = [...EXPECTED_STDOUT.matchAll(/^([^:\n]+): line (\d+):/gm)].map(
      ([, name, line]) => `${name}:${line}`,
    );
    expect({
      checked: failing.length > 0,
      unreported: [...new Set(failing)].filter((line) => !reported.includes(line)).sort(),
    }).toEqual({ checked: true, unreported: [] });
  });
});
