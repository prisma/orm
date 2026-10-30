import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { mongoTargetDescriptor } from '@internal/target-mongo/control';
import { dirname, join } from 'pathe';
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
        stdout: [
          'aliased.ts: rewrote 3 field helper calls.',
          'binds-type.ts: already binds the name "type", which the rewrite needs for the MongoDB type helpers; left unchanged. Rename the other binding and run the script again.',
          'comments.ts: rewrote 2 field helper calls.',
          'contract.ts: rewrote 23 field helper calls.',
          'renamed.ts: rewrote 4 field helper calls.',
          'unsupported.ts: rewrote 1 field helper call.',
          `unsupported.ts: line 9: field.scalar('geo/point@1'): not rewritten, as codec "geo/point@1" has no type constructor here; write it as field.scalar(type.X(...)).`,
          'unsupported.ts: line 10: field.vector({ typeParams: { length: dimensions(), other: 1 } }): not rewritten, as its arguments are not { typeParams: { length } }; write it as field.scalar(type.X(...)).',
          'Changed 5 files.',
          '',
        ].join('\n'),
      });
      expect(filesOf(dir)).toEqual(filesOf(join(fixturesDir, 'after')));
    });

    it('leaves the files it rewrote unchanged on a second run', () => {
      const dir = copyBefore();
      run(script, dir);
      const second = run(script, dir, ['contract.ts', 'aliased.ts', 'renamed.ts', 'comments.ts']);
      expect({ stdout: second.stdout, files: filesOf(dir) }).toEqual({
        stdout: 'Changed 0 files.\n',
        files: filesOf(join(fixturesDir, 'after')),
      });
    });
  },
);

describe('the rewritten contracts', () => {
  it.each([
    ['contract.contract.json', contract],
    ['contract.fromHelpers.json', fromHelpers],
    ['aliased.contract.json', aliased],
    ['renamed.contract.json', renamed],
    ['comments.contract.json', comments],
  ])('emit %s, the contract the removed helpers emitted', (emitted, built) => {
    expect(
      mongoTargetDescriptor.contractSerializer.serializeContract(
        built as Parameters<typeof mongoTargetDescriptor.contractSerializer.serializeContract>[0],
      ),
    ).toEqual(JSON.parse(readFileSync(join(fixturesDir, 'emitted', emitted), 'utf8')));
  });
});
