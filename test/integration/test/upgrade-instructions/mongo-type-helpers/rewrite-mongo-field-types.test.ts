import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { defineContract, field, model, valueObject } from '@internal/mongo/contract-builder';
import { dirname, join } from 'pathe';
import { afterAll, describe, expect, it } from 'vitest';
import { contract, fromHelpers } from './fixtures/after/contract';

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
          'binds-type.ts: already binds the name "type", which the rewrite needs for the MongoDB type helpers; left unchanged. Rename the other binding and run the script again.',
          'contract.ts: rewrote 23 field helper calls.',
          'unsupported.ts: rewrote 1 field helper call.',
          "unsupported.ts: line 9: field.scalar('geo/point@1'),: not rewritten; write it as field.scalar(type.X(...)).",
          'unsupported.ts: line 10: field.vector({ typeParams: { length: dimensions() } }),: not rewritten; write it as field.scalar(type.X(...)).',
          'Changed 2 files.',
          '',
        ].join('\n'),
      });
      expect(filesOf(dir)).toEqual(filesOf(join(fixturesDir, 'after')));
    });

    it('leaves the files it rewrote unchanged on a second run', () => {
      const dir = copyBefore();
      run(script, dir);
      const second = run(script, dir, ['contract.ts']);
      expect({ stdout: second.stdout, files: filesOf(dir) }).toEqual({
        stdout: 'Changed 0 files.\n',
        files: filesOf(join(fixturesDir, 'after')),
      });
    });
  },
);

describe('the rewritten contract', () => {
  const scalar = (codecId: string) => field.scalar({ kind: 'scalar', codecId });

  it('is the contract the removed helpers built', () => {
    const Address = valueObject('Address', {
      fields: { street: scalar('mongo/string@1'), zip: scalar('mongo/string@1').optional() },
    });
    const expected = defineContract({}, ({ gen }) => ({
      models: {
        Everything: model('Everything', {
          collection: 'everything',
          fields: {
            _id: scalar('mongo/objectId@1'),
            title: scalar('mongo/string@1'),
            ratio: scalar('mongo/double@1'),
            count: scalar('mongo/int32@1'),
            active: scalar('mongo/bool@1'),
            createdAt: scalar('mongo/date@1').onCreate(gen.now()),
            updatedAt: scalar('mongo/date@1').onCreate(gen.now()).onUpdate(gen.now()),
            big: scalar('mongo/int64@1'),
            safe: scalar('mongo/int64Number@1'),
            price: scalar('mongo/decimal128@1'),
            bytes: scalar('mongo/binary@1'),
            meta: scalar('mongo/json@1'),
            raw: scalar('mongo/bson@1'),
            embedding: field.scalar({
              kind: 'scalar',
              codecId: 'mongo/vector@1',
              typeParams: { length: 3 },
            }),
            plain: scalar('mongo/vector@1'),
            tags: scalar('mongo/string@1').many(),
            sized: field.scalar({
              kind: 'scalar',
              codecId: 'mongo/vector@1',
              typeParams: { length: 2 },
            }),
            address: field.valueObject(Address),
          },
        }),
        Tagged: model('Tagged', {
          collection: 'tagged',
          fields: { _id: scalar('mongo/objectId@1'), label: scalar('mongo/string@1') },
        }),
      },
      valueObjects: { Address },
    }));
    const note = defineContract({}, () => ({
      models: {
        Note: model('Note', {
          collection: 'notes',
          fields: { _id: scalar('mongo/objectId@1'), body: scalar('mongo/string@1') },
        }),
      },
    }));
    expect(JSON.parse(JSON.stringify({ contract, fromHelpers }))).toEqual(
      JSON.parse(JSON.stringify({ contract: expected, fromHelpers: note })),
    );
  });
});
