import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import mongoAdapter from '@internal/adapter-mongo/control';
import type { ContractSourceContext } from '@internal/cli/config-types';
import type { Contract } from '@internal/contract/types';
import { mongoFamilyDescriptor } from '@internal/family-mongo/control';
import { createControlStack } from '@internal/framework-components/control';
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
  'migrations/app/20260101T0000_initial/contract.prisma: rewrote 6 field types.',
  'src/contract.prisma: rewrote 6 field types.',
  'src/contract.ts: rewrote 2 type.Date() calls.',
  'src/published.ts: rewrote 1 type.Date() call.',
  'Changed 4 files.',
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

    it('leaves the files it rewrote unchanged on a second run', () => {
      const dir = copyBefore();
      run(script, dir);
      expect({ stdout: run(script, dir).stdout, files: filesOf(dir) }).toEqual({
        stdout: 'Changed 0 files.\n',
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

interface SerializedEntities {
  readonly [entity: string]: {
    readonly fields?: Readonly<Record<string, { readonly type?: { readonly codecId?: string } }>>;
  };
}

/** Each scalar field's codec, by `Model.field`, from the serialized contract. */
function codecsOf(contract: Contract): Readonly<Record<string, string>> {
  const json = mongoTargetDescriptor.contractSerializer.serializeContract(
    contract as MongoTargetContract,
  ) as {
    readonly domain: {
      readonly namespaces: Readonly<Record<string, Readonly<Record<string, SerializedEntities>>>>;
    };
  };
  return Object.fromEntries(
    Object.values(json.domain.namespaces).flatMap((kinds) =>
      Object.values(kinds).flatMap((entities) =>
        Object.entries(entities).flatMap(([entity, { fields = {} }]) =>
          Object.entries(fields).flatMap(([name, { type }]) =>
            type?.codecId === undefined ? [] : [[`${entity}.${name}`, type.codecId]],
          ),
        ),
      ),
    ),
  );
}

describe('the rewritten contracts', () => {
  it('keep every field the script rewrote on mongo/date@1, the codec Date named before', async () => {
    const schema = join(fixturesDir, 'after/src/contract.prisma');
    const loaded = await mongoContract(schema, { target: mongoTargetPack }).source.load({
      ...sourceContext,
      resolvedInputs: [schema],
    });
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.failure));
    expect({
      psl: codecsOf(loaded.value),
      ts: codecsOf(rewrittenTsContract),
    }).toEqual({
      psl: expect.objectContaining({
        'Post.publishedAt': 'mongo/date@1',
        'Post.editedAt': 'mongo/date@1',
        'Post.createdAt': 'mongo/date@1',
        'Post.updatedAt': 'mongo/date@1',
        'Post.reviewedAt': 'mongo/date@1',
      }),
      ts: expect.objectContaining({
        'Post.publishedAt': 'mongo/date@1',
        'Post.createdAt': 'mongo/date@1',
        'Post.updatedAt': 'mongo/date@1',
      }),
    });
  });
});
