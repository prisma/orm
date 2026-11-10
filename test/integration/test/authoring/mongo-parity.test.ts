import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import mongoAdapter from '@internal/adapter-mongo/control';
import type { ContractSourceContext } from '@internal/cli/config-types';
import { enrichContract } from '@internal/cli/control-api';
import type { SerializeContract } from '@internal/contract/hashing';
import type { Contract } from '@internal/contract/types';
import { mongoFamilyDescriptor } from '@internal/family-mongo/control';
import mongoFamilyPack from '@internal/family-mongo/pack';
import { createControlStack } from '@internal/framework-components/control';
import { type } from '@internal/mongo/contract-builder';
import { mongoContractCanonicalizationHooks } from '@internal/mongo-contract/canonicalization-hooks';
import { mongoContract } from '@internal/mongo-contract-psl/provider';
import { defineContract, field, model } from '@internal/mongo-contract-ts/contract-builder';
import { type MongoTargetContract, mongoTargetDescriptor } from '@internal/target-mongo/control';
import mongoTargetPack from '@internal/target-mongo/pack';
import { timeouts } from '@repo/test-utils';
import { dirname, join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { emit } from '../../utils/emit';

/**
 * Each case under mongo-parity/ writes one contract as contract.ts and as contract.prisma. A case with expected.contract.json must emit the same contract.json from both. A case with expected-refusal.json must be refused by both, each in its own wording: one case for each rule of the MongoDB contract builder that both sources can write. In refused-value-object-unknown-enum, PSL refuses the undeclared enum earlier, when it resolves the type name, so the builder's own check is reached only from TypeScript.
 */
const casesDir = join(dirname(fileURLToPath(import.meta.url)), 'mongo-parity');
const writeExpected = process.env['UPDATE_MONGO_PARITY_EXPECTED'] === '1';

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

const serializeContract: SerializeContract = (contract) =>
  mongoTargetDescriptor.contractSerializer.serializeContract(contract as MongoTargetContract);

/** The refusal each source reports for a case both must refuse, in its own wording, with the schema text each PSL diagnostic points at. */
interface ExpectedRefusal {
  readonly ts: { readonly code: string; readonly message: string };
  readonly psl: readonly {
    readonly code: string;
    readonly message: string;
    readonly spanText: string | null;
  }[];
}

interface ParityCase {
  readonly name: string;
  readonly contractTsPath: string;
  readonly contractPslPath: string;
  readonly expectedContractPath: string;
  readonly expectedRefusalPath: string;
}

const parityCases: readonly ParityCase[] = readdirSync(casesDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()
  .map((name) => ({
    name,
    contractTsPath: join(casesDir, name, 'contract.ts'),
    contractPslPath: join(casesDir, name, 'contract.prisma'),
    expectedContractPath: join(casesDir, name, 'expected.contract.json'),
    expectedRefusalPath: join(casesDir, name, 'expected-refusal.json'),
  }));

async function loadPsl(parityCase: ParityCase) {
  return mongoContract(parityCase.contractPslPath, { target: mongoTargetPack }).source.load({
    ...sourceContext,
    resolvedInputs: [parityCase.contractPslPath],
  });
}

async function emitContract(contract: Contract) {
  const normalized = mongoFamilyDescriptor
    .create(mongoStack)
    .deserializeContract(enrichContract(contract, [mongoTargetDescriptor, mongoAdapter]));
  return emit(normalized, mongoStack, mongoFamilyDescriptor.emission, {
    serializeContract,
    ...mongoContractCanonicalizationHooks,
  });
}

describe('Mongo contracts written in TypeScript and in PSL', () => {
  it('discovers the parity cases', () => {
    expect(parityCases.length).toBeGreaterThan(0);
  });

  for (const parityCase of parityCases) {
    if (existsSync(parityCase.expectedRefusalPath)) {
      it(
        `refuses ${parityCase.name} from both sources`,
        async () => {
          const { buildContract } = (await import(
            pathToFileURL(parityCase.contractTsPath).href
          )) as { readonly buildContract: () => Contract };
          const psl = await loadPsl(parityCase);
          const pslText = readFileSync(parityCase.contractPslPath, 'utf-8');

          const actual = {
            ts: (() => {
              try {
                buildContract();
                return undefined;
              } catch (error) {
                const { code, message } = error as { code: string; message: string };
                return { code, message };
              }
            })(),
            psl: psl.ok
              ? undefined
              : psl.failure.diagnostics.map(({ code, message, span }) => ({
                  code,
                  message,
                  spanText:
                    span === undefined ? null : pslText.slice(span.start.offset, span.end.offset),
                })),
          };
          if (writeExpected) {
            writeFileSync(
              parityCase.expectedRefusalPath,
              `${JSON.stringify(actual, null, 2)}\n`,
              'utf-8',
            );
          }

          expect(actual).toEqual(
            JSON.parse(readFileSync(parityCase.expectedRefusalPath, 'utf-8')) as ExpectedRefusal,
          );
        },
        timeouts.typeScriptCompilation,
      );
      continue;
    }

    it(
      `emits ${parityCase.name} byte for byte the same from both sources`,
      async () => {
        const { contract: tsContract } = (await import(
          pathToFileURL(parityCase.contractTsPath).href
        )) as { readonly contract: Contract };
        const psl = await loadPsl(parityCase);
        if (!psl.ok) throw new Error(JSON.stringify(psl.failure.diagnostics, null, 2));

        const fromTs = await emitContract(tsContract);
        const fromPsl = await emitContract(psl.value);

        expect({
          contractJson: fromPsl.contractJson,
          storageHash: fromPsl.storageHash,
          profileHash: fromPsl.profileHash,
        }).toEqual({
          contractJson: fromTs.contractJson,
          storageHash: fromTs.storageHash,
          profileHash: fromTs.profileHash,
        });

        if (writeExpected) {
          writeFileSync(parityCase.expectedContractPath, `${fromTs.contractJson}\n`, 'utf-8');
        }
        expect(JSON.parse(fromTs.contractJson)).toEqual(
          JSON.parse(readFileSync(parityCase.expectedContractPath, 'utf-8')),
        );
      },
      timeouts.typeScriptCompilation,
    );
  }

  it('records the extension packs of the stack from both sources', async () => {
    const extension = {
      kind: 'extension',
      id: 'audit',
      familyId: 'mongo',
      targetId: 'mongo',
      version: '0.0.1',
    } as const;
    const pslPath = join(casesDir, 'ids', 'contract.prisma');
    const tsContract = defineContract({
      family: mongoFamilyPack,
      target: mongoTargetPack,
      extensions: { audit: extension },
      models: {
        Doc: model('Doc', {
          collection: 'docs',
          fields: { id: field.scalar(type.ObjectId()).mongo({ field: '_id' }) },
        }),
      },
    });
    const psl = await mongoContract(pslPath, {
      target: mongoTargetPack,
      extensionPacks: { audit: extension },
    }).source.load({ ...sourceContext, resolvedInputs: [pslPath] });
    if (!psl.ok) throw new Error(JSON.stringify(psl.failure.diagnostics));

    expect({ ts: tsContract.extensions, psl: psl.value.extensions }).toEqual({
      ts: { audit: extension },
      psl: { audit: extension },
    });
  });
});
