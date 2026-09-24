import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import mongoAdapter from '@internal/adapter-mongo/control';
import postgresAdapter from '@internal/adapter-postgres/control';
import type { ContractSourceContext } from '@internal/cli/config-types';
import { enrichContract } from '@internal/cli/control-api';
import type { SerializeContract } from '@internal/contract/hashing';
import type { Contract } from '@internal/contract/types';
import { mongoFamilyDescriptor } from '@internal/family-mongo/control';
import { MongoContractSerializer } from '@internal/family-mongo/ir';
import sql from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import type { MongoContract } from '@internal/mongo-contract';
import { mongoContractCanonicalizationHooks } from '@internal/mongo-contract/canonicalization-hooks';
import { mongoContract } from '@internal/mongo-contract-psl/provider';
import { sqlContractCanonicalizationHooks } from '@internal/sql-contract/canonicalization-hooks';
import type { SqlStorage } from '@internal/sql-contract/types';
import { prismaContract } from '@internal/sql-contract-psl/provider';
import { type MongoTargetContract, mongoTargetDescriptor } from '@internal/target-mongo/control';
import postgres from '@internal/target-postgres/control';
import postgresPackRef from '@internal/target-postgres/pack';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { timeouts } from '@repo/test-utils';
import { dirname, join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { emit } from '../../utils/emit';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureRootDir = join(__dirname, 'side-by-side');
const shouldUpdateExpected = process.env['UPDATE_SIDE_BY_SIDE_CONTRACTS'] === '1';

const sqlStack = createControlStack({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
});

const mongoStack = createControlStack({
  family: mongoFamilyDescriptor,
  target: mongoTargetDescriptor,
  adapter: mongoAdapter,
});

const sqlSourceContext: ContractSourceContext = {
  composedExtensions: [],
  composedExtensionContracts: new Map(),
  authoringContributions: sqlStack.authoringContributions,
  codecLookup: sqlStack.codecLookup,
  dataTypeLookup: sqlStack.dataTypeLookup,
  controlMutationDefaults: sqlStack.controlMutationDefaults,
  resolvedInputs: [],
  capabilities: sqlStack.capabilities,
};

const mongoSourceContext: ContractSourceContext = {
  composedExtensions: [],
  composedExtensionContracts: new Map(),
  authoringContributions: mongoStack.authoringContributions,
  codecLookup: mongoStack.codecLookup,
  dataTypeLookup: mongoStack.dataTypeLookup,
  controlMutationDefaults: mongoStack.controlMutationDefaults,
  resolvedInputs: [],
  capabilities: mongoStack.capabilities,
};

type FixtureName = 'postgres' | 'mongo';

interface FixtureCase {
  readonly name: FixtureName;
  readonly caseDir: string;
  readonly contractTsPath: string;
  readonly contractPslPath: string;
  readonly expectedContractJsonPath: string;
}

interface LoadedFixture {
  readonly tsContract: Contract;
}

const fixtureNames = ['postgres', 'mongo'] as const satisfies readonly FixtureName[];

const fixtureCases: readonly FixtureCase[] = fixtureNames.map((name): FixtureCase => {
  const caseDir = join(fixtureRootDir, name);
  return {
    name,
    caseDir,
    contractTsPath: join(caseDir, 'contract.ts'),
    contractPslPath: join(caseDir, 'contract.prisma'),
    expectedContractJsonPath: join(caseDir, 'contract.json'),
  };
});

function parseContractJson(contractJson: string): Record<string, unknown> {
  return JSON.parse(contractJson) as Record<string, unknown>;
}

async function loadFixture(fixtureCase: FixtureCase): Promise<LoadedFixture> {
  const contractModule = (await import(pathToFileURL(fixtureCase.contractTsPath).href)) as {
    readonly contract: Contract;
  };

  return {
    tsContract: contractModule.contract,
  };
}

function readExpectedContractJson(fixtureCase: FixtureCase): string {
  if (!existsSync(fixtureCase.expectedContractJsonPath)) {
    if (shouldUpdateExpected) {
      return '';
    }
    throw new Error(
      `Expected contract snapshot not found: ${fixtureCase.expectedContractJsonPath}. ` +
        'Run with UPDATE_SIDE_BY_SIDE_CONTRACTS=1 to create it.',
    );
  }

  return readFileSync(fixtureCase.expectedContractJsonPath, 'utf-8').trim();
}

function writeExpectedContractJson(fixtureCase: FixtureCase, contractJson: string): void {
  writeFileSync(fixtureCase.expectedContractJsonPath, `${contractJson}\n`, 'utf-8');
}

function validateEmittedSqlContract(contractJson: Record<string, unknown>) {
  return new PostgresContractSerializer().deserializeContract(contractJson) as Contract<SqlStorage>;
}

function validateEmittedMongoContract(contractJson: Record<string, unknown>) {
  const contract = new MongoContractSerializer().deserializeContract(contractJson) as MongoContract;
  return { contract };
}

describe('side-by-side contract examples', () => {
  it('discovers Postgres and Mongo fixtures', () => {
    expect(fixtureCases).toHaveLength(2);
    expect(fixtureCases.map((fixtureCase) => fixtureCase.name)).toEqual(['postgres', 'mongo']);
  });

  it(
    'loads the side-by-side fixture files from disk',
    async () => {
      const fixtures = await Promise.all(fixtureCases.map(loadFixture));

      expect(fixtures).toHaveLength(2);
    },
    // Reading + parsing the fixture files is local I/O; the 100ms package
    // default flakes on cold CI workers. vitestPackageDefault is the
    // documented baseline for exactly this case.
    timeouts.vitestPackageDefault,
  );

  it(
    'validates and emits the Postgres side-by-side contract from TS and PSL',
    async () => {
      const fixtureCase = fixtureCases.find((candidate) => candidate.name === 'postgres');
      if (!fixtureCase) {
        throw new Error('Postgres fixture not found');
      }

      const fixture = await loadFixture(fixtureCase);
      const provider = prismaContract(fixtureCase.contractPslPath, {
        target: postgresPackRef,
        createNamespace: postgresCreateNamespace,
      });

      const providerResult = await provider.source.load({
        ...sqlSourceContext,
        resolvedInputs: [fixtureCase.contractPslPath],
      });
      expect(providerResult.ok).toBe(true);
      if (!providerResult.ok) {
        throw new Error(providerResult.failure.summary);
      }

      const familyInstance = sql.create(sqlStack);
      const frameworkComponents = [postgres, postgresAdapter];

      type PostgresSerializerInput = Parameters<
        typeof postgres.contractSerializer.serializeContract
      >[0];
      const normalizedTs = familyInstance.deserializeContract(
        postgres.contractSerializer.serializeContract(
          enrichContract(fixture.tsContract, frameworkComponents) as PostgresSerializerInput,
        ),
      );
      const normalizedPsl = familyInstance.deserializeContract(
        postgres.contractSerializer.serializeContract(
          enrichContract(providerResult.value, frameworkComponents) as PostgresSerializerInput,
        ),
      );

      expect(normalizedTs).toEqual(normalizedPsl);

      const sqlSerializeContract: SerializeContract = (contract) =>
        postgres.contractSerializer.serializeContract(
          contract as Parameters<typeof postgres.contractSerializer.serializeContract>[0],
        );
      const emittedTs = await emit(normalizedTs, sqlStack, sql.emission, {
        serializeContract: sqlSerializeContract,
        ...sqlContractCanonicalizationHooks,
      });
      const emittedPsl = await emit(normalizedPsl, sqlStack, sql.emission, {
        serializeContract: sqlSerializeContract,
        ...sqlContractCanonicalizationHooks,
      });

      expect(emittedTs.contractJson).toBe(emittedPsl.contractJson);

      const emittedContractJson = parseContractJson(emittedTs.contractJson);
      const validatedContract = validateEmittedSqlContract(emittedContractJson);

      expect(validatedContract.roots).toEqual({
        posts: { namespace: 'public', model: 'Post' },
        users: { namespace: 'public', model: 'User' },
      });
      expect(
        validatedContract.domain.namespaces['public']!.models['User']?.relations['posts'],
      ).toMatchObject({
        cardinality: '1:N',
        to: { namespace: 'public', model: 'Post' },
      });
      expect(
        validatedContract.domain.namespaces['public']!.models['Post']?.relations['author'],
      ).toMatchObject({
        cardinality: 'N:1',
        to: { namespace: 'public', model: 'User' },
        on: {
          localFields: ['authorId'],
          targetFields: ['id'],
        },
      });

      if (shouldUpdateExpected) {
        writeExpectedContractJson(fixtureCase, emittedTs.contractJson);
      }

      expect(emittedTs.contractJson).toBe(readExpectedContractJson(fixtureCase));
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'validates and emits the Mongo side-by-side contract from TS and PSL',
    async () => {
      const fixtureCase = fixtureCases.find((candidate) => candidate.name === 'mongo');
      if (!fixtureCase) {
        throw new Error('Mongo fixture not found');
      }

      const fixture = await loadFixture(fixtureCase);
      const provider = mongoContract(fixtureCase.contractPslPath);
      const providerResult = await provider.source.load({
        ...mongoSourceContext,
        resolvedInputs: [fixtureCase.contractPslPath],
      });
      expect(providerResult.ok).toBe(true);
      if (!providerResult.ok) {
        throw new Error(providerResult.failure.summary);
      }

      const familyInstance = mongoFamilyDescriptor.create(mongoStack);
      const frameworkComponents = [mongoTargetDescriptor, mongoAdapter];

      const normalizedTs = familyInstance.deserializeContract(
        enrichContract(fixture.tsContract, frameworkComponents),
      );
      const normalizedPsl = familyInstance.deserializeContract(
        enrichContract(providerResult.value, frameworkComponents),
      );

      const stripValidatorFields = (contract: typeof normalizedTs) => {
        const storage = contract.storage as unknown as Record<string, unknown>;
        const namespaces = storage['namespaces'] as Record<string, Record<string, unknown>>;
        const strippedNamespaces: Record<string, unknown> = {};
        for (const [nsId, ns] of Object.entries(namespaces)) {
          const entries = ns['entries'] as { collection: Record<string, Record<string, unknown>> };
          const collections = entries.collection;
          const strippedCollections: Record<string, unknown> = {};
          for (const [name, coll] of Object.entries(collections)) {
            const { validator: _, ...rest } = coll;
            strippedCollections[name] = rest;
          }
          strippedNamespaces[nsId] = {
            ...ns,
            entries: { ...(ns['entries'] as object), collection: strippedCollections },
          };
        }
        const { storageHash: _sh, ...restStorage } = storage;
        return { ...contract, storage: { ...restStorage, namespaces: strippedNamespaces } };
      };
      expect(stripValidatorFields(normalizedTs)).toEqual(stripValidatorFields(normalizedPsl));

      const mongoSerializeContract: SerializeContract = (contract) =>
        mongoTargetDescriptor.contractSerializer.serializeContract(contract as MongoTargetContract);
      const emittedTs = await emit(normalizedTs, mongoStack, mongoFamilyDescriptor.emission, {
        serializeContract: mongoSerializeContract,
        ...mongoContractCanonicalizationHooks,
      });
      const emittedPsl = await emit(normalizedPsl, mongoStack, mongoFamilyDescriptor.emission, {
        serializeContract: mongoSerializeContract,
        ...mongoContractCanonicalizationHooks,
      });

      const stripForComparison = (json: string) => {
        const parsed = JSON.parse(json) as Record<string, unknown>;
        const storage = parsed['storage'] as Record<string, unknown>;
        const namespaces = storage['namespaces'] as Record<string, Record<string, unknown>>;
        const strippedNamespaces: Record<string, unknown> = {};
        for (const [nsId, ns] of Object.entries(namespaces)) {
          const entries = ns['entries'] as { collection: Record<string, Record<string, unknown>> };
          const collections = entries.collection;
          const strippedCollections: Record<string, unknown> = {};
          for (const [name, coll] of Object.entries(collections)) {
            const { validator: _, ...rest } = coll;
            strippedCollections[name] = rest;
          }
          strippedNamespaces[nsId] = {
            ...ns,
            entries: { ...(ns['entries'] as object), collection: strippedCollections },
          };
        }
        const { storageHash: _sh, ...restStorage } = storage;
        return { ...parsed, storage: { ...restStorage, namespaces: strippedNamespaces } };
      };
      expect(stripForComparison(emittedTs.contractJson)).toEqual(
        stripForComparison(emittedPsl.contractJson),
      );

      const emittedContractJson = parseContractJson(emittedPsl.contractJson);
      const validatedContract = validateEmittedMongoContract(emittedContractJson);

      expect(validatedContract.contract.roots).toEqual({
        posts: { namespace: '__unbound__', model: 'Post' },
        users: { namespace: '__unbound__', model: 'User' },
      });
      expect(
        validatedContract.contract.domain.namespaces['__unbound__']!.models['User']?.relations[
          'posts'
        ],
      ).toMatchObject({
        cardinality: '1:N',
        to: { namespace: '__unbound__', model: 'Post' },
        on: {
          localFields: ['_id'],
          targetFields: ['authorId'],
        },
      });
      expect(
        validatedContract.contract.domain.namespaces['__unbound__']!.models['Post']?.relations[
          'author'
        ],
      ).toMatchObject({
        cardinality: 'N:1',
        to: { namespace: '__unbound__', model: 'User' },
        on: {
          localFields: ['authorId'],
          targetFields: ['_id'],
        },
      });

      if (shouldUpdateExpected) {
        writeExpectedContractJson(fixtureCase, emittedPsl.contractJson);
      }

      expect(emittedPsl.contractJson).toBe(readExpectedContractJson(fixtureCase));
    },
    timeouts.typeScriptCompilation,
  );

  it('keeps the Postgres and Mongo examples structurally comparable', async () => {
    const postgresFixture = fixtureCases.find((candidate) => candidate.name === 'postgres');
    const mongoFixture = fixtureCases.find((candidate) => candidate.name === 'mongo');
    if (!postgresFixture || !mongoFixture) {
      throw new Error('Side-by-side fixtures not found');
    }

    const postgresContractJson = parseContractJson(readExpectedContractJson(postgresFixture));
    const mongoContractJson = parseContractJson(readExpectedContractJson(mongoFixture));

    expect(postgresContractJson['roots']).toEqual({
      posts: { namespace: 'public', model: 'Post' },
      users: { namespace: 'public', model: 'User' },
    });
    expect(mongoContractJson['roots']).toEqual({
      posts: { namespace: '__unbound__', model: 'Post' },
      users: { namespace: '__unbound__', model: 'User' },
    });

    const postgresModels = (
      postgresContractJson['domain'] as {
        namespaces: Record<string, { models: Record<string, unknown> }>;
      }
    ).namespaces['public']!.models;
    const mongoModels = (
      mongoContractJson['domain'] as {
        namespaces: Record<string, { models: Record<string, unknown> }>;
      }
    ).namespaces['__unbound__']!.models;

    type SideBySideModel = { relations?: Record<string, unknown> };
    expect((postgresModels['User'] as SideBySideModel | undefined)?.relations).toMatchObject({
      posts: { cardinality: '1:N', to: { namespace: 'public', model: 'Post' } },
    });
    expect((mongoModels['User'] as SideBySideModel | undefined)?.relations).toMatchObject({
      posts: { cardinality: '1:N', to: { namespace: '__unbound__', model: 'Post' } },
    });
    expect((postgresModels['Post'] as SideBySideModel | undefined)?.relations).toMatchObject({
      author: { cardinality: 'N:1', to: { namespace: 'public', model: 'User' } },
    });
    expect((mongoModels['Post'] as SideBySideModel | undefined)?.relations).toMatchObject({
      author: { cardinality: 'N:1', to: { namespace: '__unbound__', model: 'User' } },
    });
  });
});
