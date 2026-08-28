import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { ContractSourceContext } from '@internal/config/config-types';
import type { Contract, ControlPolicy } from '@internal/contract/types';
import { emptyCodecLookup } from '@internal/framework-components/codec';
import { timeouts } from '@repo/test-utils';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { typescriptContract, typescriptContractFromPath } from '../src/config-types';

const emptyContext: ContractSourceContext = {
  composedExtensions: [],
  composedExtensionContracts: new Map(),

  authoringContributions: {
    field: {},
    type: {},
    entityTypes: {},
    pslBlockDescriptors: {},
    modelAttributes: {},
    attributeSpecs: { model: {}, field: {} },
  },
  codecLookup: emptyCodecLookup,
  controlMutationDefaults: {
    defaultFunctionRegistry: new Map(),
    generatorDescriptors: [],
  },
  resolvedInputs: [],
  capabilities: {},
};

function minimalMongoContract(overrides?: {
  readonly defaultControlPolicy?: ControlPolicy;
}): Contract {
  return {
    targetFamily: 'mongo',
    target: 'mongo',
    ...overrides,
  } as unknown as Contract;
}

describe('source format discriminator', () => {
  it('typescriptContract tags the source as TypeScript', () => {
    const config = typescriptContract(minimalMongoContract());
    expect(config.source.format).toBe('typescript');
  });

  it('typescriptContractFromPath tags the source as TypeScript', () => {
    const config = typescriptContractFromPath('./contract.ts');
    expect(config.source.format).toBe('typescript');
  });
});

describe('defaultControlPolicy specifier precedence', () => {
  it('typescriptContract keeps an existing contract default when the specifier sets another', async () => {
    const contract = minimalMongoContract({ defaultControlPolicy: 'managed' });
    const config = typescriptContract(contract, undefined, { defaultControlPolicy: 'external' });
    const result = await config.source.load(emptyContext);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.defaultControlPolicy).toBe('managed');
  });

  it('typescriptContract applies the specifier default when the contract omits one', async () => {
    const contract = minimalMongoContract();
    const config = typescriptContract(contract, undefined, { defaultControlPolicy: 'external' });
    const result = await config.source.load(emptyContext);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.defaultControlPolicy).toBe('external');
  });

  it('typescriptContract leaves defaultControlPolicy unset when the specifier omits it', async () => {
    const contract = minimalMongoContract();
    const config = typescriptContract(contract);
    const result = await config.source.load(emptyContext);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).not.toHaveProperty('defaultControlPolicy');
  });

  it(
    'typescriptContractFromPath keeps an existing contract default when the specifier sets another',
    async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'mongo-contract-ts-policy-'));
      const contractPath = join(tempDir, 'contract.ts');

      try {
        await writeFile(
          contractPath,
          `export default { targetFamily: 'mongo', target: 'mongo', defaultControlPolicy: 'managed' };\n`,
          'utf-8',
        );

        const config = typescriptContractFromPath('./contract.ts', undefined, {
          defaultControlPolicy: 'external',
        });
        const result = await config.source.load({
          ...emptyContext,
          resolvedInputs: [contractPath],
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.defaultControlPolicy).toBe('managed');
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'typescriptContractFromPath applies the specifier default when the module omits one',
    async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'mongo-contract-ts-policy-'));
      const contractPath = join(tempDir, 'contract.ts');

      try {
        await writeFile(
          contractPath,
          `export default { targetFamily: 'mongo', target: 'mongo' };\n`,
          'utf-8',
        );

        const config = typescriptContractFromPath('./contract.ts', undefined, {
          defaultControlPolicy: 'tolerated',
        });
        const result = await config.source.load({
          ...emptyContext,
          resolvedInputs: [contractPath],
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.defaultControlPolicy).toBe('tolerated');
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'typescriptContractFromPath leaves defaultControlPolicy unset when the specifier omits it',
    async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'mongo-contract-ts-policy-'));
      const contractPath = join(tempDir, 'contract.ts');

      try {
        await writeFile(
          contractPath,
          `export default { targetFamily: 'mongo', target: 'mongo' };\n`,
          'utf-8',
        );

        const config = typescriptContractFromPath('./contract.ts');
        const result = await config.source.load({
          ...emptyContext,
          resolvedInputs: [contractPath],
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value).not.toHaveProperty('defaultControlPolicy');
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    },
    timeouts.typeScriptCompilation,
  );
});

describe('typescriptContract', () => {
  it('returns provider result with contract', async () => {
    const contract = { targetFamily: 'mongo', target: 'mongo' } as unknown as Contract;
    const config = typescriptContract(contract, 'output/contract.json');
    const result = await config.source.load(emptyContext);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.value).toBe(contract);
    expect(config.output).toBe('output/contract.json');
    expect(config.source.inputs).toBeUndefined();
  });

  it('omits output when not provided', () => {
    const contract = { targetFamily: 'mongo', target: 'mongo' } as unknown as Contract;
    const config = typescriptContract(contract);

    expect(config.output).toBeUndefined();
    expect(config.source.inputs).toBeUndefined();
  });

  it(
    'loads a contract module from the resolved input path',
    async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'mongo-contract-ts-'));
      const contractPath = join(tempDir, 'contract.ts');

      try {
        await writeFile(
          contractPath,
          `export default { targetFamily: 'mongo', target: 'mongo' };\n`,
          'utf-8',
        );

        const config = typescriptContractFromPath('./contract.ts');
        const result = await config.source.load({
          ...emptyContext,
          resolvedInputs: [contractPath],
        });

        expect(result.ok).toBe(true);
        if (!result.ok) {
          return;
        }

        expect(result.value).toMatchObject({
          targetFamily: 'mongo',
          target: 'mongo',
        });
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'throws when the module exports neither default nor contract',
    async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'mongo-contract-ts-'));
      const contractPath = join(tempDir, 'contract.ts');

      try {
        await writeFile(contractPath, 'export const notContract = {};\n', 'utf-8');

        const config = typescriptContractFromPath('./contract.ts');

        await expect(
          config.source.load({
            ...emptyContext,
            resolvedInputs: [contractPath],
          }),
        ).rejects.toThrow(/has no "default" or "contract" export/);
        await expect(
          config.source.load({
            ...emptyContext,
            resolvedInputs: [contractPath],
          }),
        ).rejects.toMatchObject({ code: 'CONTRACT.MODULE_EXPORT_MISSING' });
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    },
    timeouts.typeScriptCompilation,
  );

  it('throws InternalError when resolvedInputs is empty', async () => {
    const config = typescriptContractFromPath('./contract.ts');

    await expect(config.source.load(emptyContext)).rejects.toMatchObject({
      isPrismaInternalError: true,
    });
  });
});
