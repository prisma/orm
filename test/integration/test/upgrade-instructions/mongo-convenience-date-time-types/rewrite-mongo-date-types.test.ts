import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import mongoAdapter from '@internal/adapter-mongo/control';
import type { ContractSourceContext } from '@internal/cli/config-types';
import type { Contract } from '@internal/contract/types';
import { mongoFamilyDescriptor } from '@internal/family-mongo/control';
import { createControlStack } from '@internal/framework-components/control';
import { defineContract, field, model, type } from '@internal/mongo/contract-builder';
import { mongoContract } from '@internal/mongo-contract-psl/provider';
import { type MongoTargetContract, mongoTargetDescriptor } from '@internal/target-mongo/control';
import mongoTargetPack from '@internal/target-mongo/pack';
import { dirname, join, relative } from 'pathe';
import { afterAll, describe, expect, it } from 'vitest';
import { contract as rewrittenTsContract } from './fixtures/after/src/contract';

const SCRIPT_PATHS = {
  app: 'upgrade-instructions/pending/mongo-convenience-date-time-types/app/scripts/rewrite-mongo-date-types.ts',
  extension:
    'upgrade-instructions/pending/mongo-convenience-date-time-types/extension/scripts/rewrite-mongo-date-types.ts',
} as const;

const EXPECTED_STDOUT = [
  "bookings/schema/booking.prisma: line 6: Date names the Date declared in bookings/schema/date.prisma line 1, not MongoDB's date; the script leaves this schema as it is.",
  'migrations/app/20260101T0000_initial/contract.prisma: rewrote 6 field types.',
  'src/contract.prisma: rewrote 6 field types.',
  'src/contract.ts: rewrote 2 type.Date() calls.',
  'src/namespaced.ts: rewrote 1 type.Date() call.',
  'src/published.ts: rewrote 1 type.Date() call.',
  'src/unknown.ts: line 4: types.Date(): the script cannot tell this is the type of a MongoDB contract builder; if it is, write DateTime.',
  'Changed 5 files.',
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
  const dir = mkdtempSync(join(tmpdir(), 'mongo-convenience-date-time-types-'));
  workDirs.push(dir);
  cpSync(join(fixturesDir, 'before'), dir, { recursive: true });
  return dir;
}

function filesOf(dir: string, under = dir): Record<string, string> {
  return Object.fromEntries(
    readdirSync(under).flatMap((name) => {
      const path = join(under, name);
      return statSync(path).isDirectory()
        ? Object.entries(filesOf(dir, path))
        : [[relative(dir, path), readFileSync(path, 'utf8')]];
    }),
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
  'the %s rewrite-mongo-date-types script',
  (_, script) => {
    it('rewrites Date to DateTime in MongoDB schemas and contracts, and leaves SQL and Prisma 6 schemas alone', () => {
      const dir = copyBefore();
      const result = run(script, dir);
      expect({ status: result.status, stderr: result.stderr, stdout: result.stdout }).toEqual({
        status: 0,
        stderr: '',
        stdout: EXPECTED_STDOUT,
      });
      expect(filesOf(dir)).toEqual(filesOf(join(fixturesDir, 'after')));
    });

    it('rewrites only the files it is given', () => {
      const dir = copyBefore();
      const result = run(script, dir, ['src/contract.prisma', 'sql']);
      expect({
        stdout: result.stdout,
        snapshot: readFileSync(
          join(dir, 'migrations/app/20260101T0000_initial/contract.prisma'),
          'utf8',
        ),
      }).toEqual({
        stdout: 'src/contract.prisma: rewrote 6 field types.\nChanged 1 file.\n',
        snapshot: readFileSync(
          join(fixturesDir, 'before/migrations/app/20260101T0000_initial/contract.prisma'),
          'utf8',
        ),
      });
    });

    it('leaves a schema whose other file declares Date when it is given only the file that uses Date', () => {
      const dir = copyBefore();
      const result = run(script, dir, ['bookings/schema/booking.prisma']);
      expect({
        stdout: result.stdout,
        booking: readFileSync(join(dir, 'bookings/schema/booking.prisma'), 'utf8'),
      }).toEqual({
        stdout: `${EXPECTED_STDOUT.split('\n')[0]}\nChanged 0 files.\n`,
        booking: readFileSync(join(fixturesDir, 'before/bookings/schema/booking.prisma'), 'utf8'),
      });
    });

    it('leaves the files it rewrote unchanged on a second run', () => {
      const dir = copyBefore();
      run(script, dir);
      expect({ stdout: run(script, dir).stdout, files: filesOf(dir) }).toEqual({
        stdout: [
          EXPECTED_STDOUT.split('\n').find((line) => line.startsWith('bookings/')),
          EXPECTED_STDOUT.split('\n').find((line) => line.startsWith('src/unknown.ts')),
          'Changed 0 files.',
          '',
        ].join('\n'),
        files: filesOf(join(fixturesDir, 'after')),
      });
    });
  },
);

const mongoStack = createControlStack({
  family: mongoFamilyDescriptor,
  target: mongoTargetDescriptor,
  adapter: mongoAdapter,
});

const sourceContext: ContractSourceContext = {
  composedExtensions: [],
  defaultNamespaceId: mongoStack.target.defaultNamespaceId,
  composedExtensionContracts: new Map(),
  authoringContributions: mongoStack.authoringContributions,
  codecLookup: mongoStack.codecLookup,
  dataTypes: mongoStack.dataTypes,
  controlMutationDefaults: mongoStack.controlMutationDefaults,
  generatorFunctions: mongoStack.generatorFunctions,
  resolvedInputs: [],
  capabilities: mongoStack.capabilities,
};

const serialize = (contract: Contract) =>
  mongoTargetDescriptor.contractSerializer.serializeContract(contract as MongoTargetContract);

/** The type constructor `Date` was before this release: an instant read as a JavaScript Date. */
const dateBeforeThisRelease = {
  kind: 'typeConstructor',
  documentation: 'A date and time with millisecond precision, stored as BSON date.',
  output: { codecId: 'mongo/date@1' },
} as const;

async function loadSchema(schema: string, context: ContractSourceContext): Promise<Contract> {
  const loaded = await mongoContract(schema, { target: mongoTargetPack }).source.load({
    ...context,
    resolvedInputs: [schema],
  });
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.failure));
  return loaded.value;
}

describe('the rewritten contracts', () => {
  it('emit the contract the schema emitted before, when Date was an instant', async () => {
    const before = await loadSchema(join(fixturesDir, 'before/src/contract.prisma'), {
      ...sourceContext,
      authoringContributions: {
        ...sourceContext.authoringContributions,
        type: { ...sourceContext.authoringContributions.type, Date: dateBeforeThisRelease },
      },
    });
    const after = await loadSchema(join(fixturesDir, 'after/src/contract.prisma'), sourceContext);

    expect(serialize(after)).toEqual(serialize(before));
  });

  it('emit the contract the TypeScript contract built before, when type.Date() was DateJsDate', () => {
    const before = defineContract({}, ({ gen, type: t }) => ({
      models: {
        Post: model('Post', {
          collection: 'posts',
          fields: {
            _id: field.scalar(type.ObjectId()),
            publishedAt: field.scalar(type.DateJsDate()).optional(),
            createdAt: field.scalar(t.DateJsDate()).onCreate(gen.now()),
            updatedAt: field.scalar(type.DateTime()).onCreate(gen.now()).onUpdate(gen.now()),
          },
        }),
      },
    }));

    expect(serialize(rewrittenTsContract)).toEqual(serialize(before));
  });
});
