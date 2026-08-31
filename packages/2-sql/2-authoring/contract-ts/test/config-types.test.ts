import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { ContractSourceContext } from '@internal/config/config-types';
import {
  type Contract,
  type ControlPolicy,
  domainModelsAtDefaultNamespace,
} from '@internal/contract/types';
import type { TargetPackRef } from '@internal/framework-components/components';
import { timeouts } from '@repo/test-utils';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { emptyContract, typescriptContract, typescriptContractFromPath } from '../src/config-types';

const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
};

const stubContext: ContractSourceContext = {
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
  codecLookup: {
    get: () => undefined,
    targetTypesFor: () => undefined,
    renderOutputTypeFor: () => undefined,
  },
  controlMutationDefaults: { defaultFunctionRegistry: new Map(), generatorDescriptors: [] },
  resolvedInputs: [],
  capabilities: {},
};

describe('source format discriminator', () => {
  it('typescriptContract tags the source as TypeScript', () => {
    const config = typescriptContract({ targetFamily: 'sql', target: 'postgres' } as Contract);
    expect(config.source.format).toBe('typescript');
  });

  it('typescriptContractFromPath tags the source as TypeScript', () => {
    const config = typescriptContractFromPath('./contract.ts');
    expect(config.source.format).toBe('typescript');
  });

  it('emptyContract tags the source as TypeScript', () => {
    const config = emptyContract({
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
    });
    expect(config.source.format).toBe('typescript');
  });
});

describe('typescriptContract', () => {
  it('returns provider result with contract', async () => {
    const contract = { targetFamily: 'sql', target: 'postgres' } as Contract;
    const config = typescriptContract(contract, 'output/contract.json');
    const result = await config.source.load(stubContext);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toBe(contract);
    expect(config.output).toBe('output/contract.json');
    expect(config.source.inputs).toBeUndefined();
  });

  it('omits output when not provided', () => {
    const contract = { targetFamily: 'sql', target: 'postgres' } as Contract;
    const config = typescriptContract(contract);

    expect(config.output).toBeUndefined();
    expect(config.source.inputs).toBeUndefined();
  });

  it('derives output colocated with input path when output is not provided (TML-2461)', () => {
    const config = typescriptContractFromPath('./prisma/contract.ts');
    expect(config.output).toBe('./prisma/contract.json');
  });

  it('honours an explicit output over the derived default', () => {
    const config = typescriptContractFromPath('./prisma/contract.ts', 'custom/out.json');
    expect(config.output).toBe('custom/out.json');
  });

  it('derives output for an extensionless input path', () => {
    const config = typescriptContractFromPath('./prisma/contract');
    expect(config.output).toBe('./prisma/contract.json');
  });

  it(
    'loads a contract module from the resolved input path',
    async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'sql-contract-ts-'));
      const contractPath = join(tempDir, 'contract.ts');

      try {
        await writeFile(
          contractPath,
          `export default { targetFamily: 'sql', target: 'postgres' };\n`,
          'utf-8',
        );

        const config = typescriptContractFromPath('./contract.ts');
        const result = await config.source.load({
          ...stubContext,
          resolvedInputs: [contractPath],
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.value).toMatchObject({
          targetFamily: 'sql',
          target: 'postgres',
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
      const tempDir = await mkdtemp(join(tmpdir(), 'sql-contract-ts-'));
      const contractPath = join(tempDir, 'contract.ts');

      try {
        await writeFile(contractPath, 'export const notContract = {};\n', 'utf-8');

        const config = typescriptContractFromPath('./contract.ts');

        await expect(
          config.source.load({
            ...stubContext,
            resolvedInputs: [contractPath],
          }),
        ).rejects.toThrow(/has no "default" or "contract" export/);

        await expect(
          config.source.load({
            ...stubContext,
            resolvedInputs: [contractPath],
          }),
        ).rejects.toThrow(expect.objectContaining({ code: 'CONTRACT.MODULE_EXPORT_MISSING' }));
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }
    },
    timeouts.typeScriptCompilation,
  );
});

function minimalSqlContract(overrides?: {
  readonly defaultControlPolicy?: ControlPolicy;
}): Contract {
  return {
    targetFamily: 'sql',
    target: 'postgres',
    ...overrides,
  } as Contract;
}

describe('defaultControlPolicy specifier precedence', () => {
  it('typescriptContract keeps an existing contract default when the specifier sets another', async () => {
    const contract = minimalSqlContract({ defaultControlPolicy: 'managed' });
    const config = typescriptContract(contract, undefined, {
      defaultControlPolicy: 'external',
      createNamespace: createTestSqlNamespace,
    });
    const result = await config.source.load(stubContext);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.defaultControlPolicy).toBe('managed');
  });

  it('typescriptContract applies the specifier default when the contract omits one', async () => {
    const contract = minimalSqlContract();
    const config = typescriptContract(contract, undefined, {
      defaultControlPolicy: 'external',
      createNamespace: createTestSqlNamespace,
    });
    const result = await config.source.load(stubContext);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.defaultControlPolicy).toBe('external');
  });

  it('typescriptContract leaves defaultControlPolicy unset when the specifier omits it', async () => {
    const contract = minimalSqlContract();
    const config = typescriptContract(contract);
    const result = await config.source.load(stubContext);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).not.toHaveProperty('defaultControlPolicy');
  });

  it(
    'typescriptContractFromPath keeps an existing contract default when the specifier sets another',
    async () => {
      const tempDir = await mkdtemp(join(tmpdir(), 'sql-contract-ts-policy-'));
      const contractPath = join(tempDir, 'contract.ts');

      try {
        await writeFile(
          contractPath,
          `export default { targetFamily: 'sql', target: 'postgres', defaultControlPolicy: 'managed' };\n`,
          'utf-8',
        );

        const config = typescriptContractFromPath('./contract.ts', undefined, {
          defaultControlPolicy: 'external',
          createNamespace: createTestSqlNamespace,
        });
        const result = await config.source.load({
          ...stubContext,
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
      const tempDir = await mkdtemp(join(tmpdir(), 'sql-contract-ts-policy-'));
      const contractPath = join(tempDir, 'contract.ts');

      try {
        await writeFile(
          contractPath,
          `export default { targetFamily: 'sql', target: 'postgres' };\n`,
          'utf-8',
        );

        const config = typescriptContractFromPath('./contract.ts', undefined, {
          defaultControlPolicy: 'tolerated',
          createNamespace: createTestSqlNamespace,
        });
        const result = await config.source.load({
          ...stubContext,
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
      const tempDir = await mkdtemp(join(tmpdir(), 'sql-contract-ts-policy-'));
      const contractPath = join(tempDir, 'contract.ts');

      try {
        await writeFile(
          contractPath,
          `export default { targetFamily: 'sql', target: 'postgres' };\n`,
          'utf-8',
        );

        const config = typescriptContractFromPath('./contract.ts');
        const result = await config.source.load({
          ...stubContext,
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

describe('emptyContract', () => {
  it('loads an empty SQL contract for the target', async () => {
    const config = emptyContract({
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
    });
    const result = await config.source.load(stubContext);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const contract = result.value;
    expect(domainModelsAtDefaultNamespace(contract.domain)).toEqual({});
    expect(contract.targetFamily).toBe('sql');
    expect(contract.target).toBe('postgres');
    expect(contract.extensions).toEqual({});
    expect(contract.capabilities).toEqual({});
    const publicNamespace = contract.storage.namespaces['public'] as unknown as Record<
      string,
      unknown
    >;
    const entries = publicNamespace['entries'] as Record<string, unknown>;
    expect(entries['table']).toEqual({});
  });

  it('sets output when passed and omits it otherwise', () => {
    const withOutput = emptyContract({
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      output: 'src/contract.json',
    });
    expect(withOutput.output).toBe('src/contract.json');

    const withoutOutput = emptyContract({
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
    });
    expect(withoutOutput.output).toBeUndefined();
  });

  it('applies defaultControlPolicy from the specifier options bag', async () => {
    const config = emptyContract({
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
      defaultControlPolicy: 'observed',
    });
    const result = await config.source.load(stubContext);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.defaultControlPolicy).toBe('observed');
  });

  it('omits defaultControlPolicy when the specifier options bag omits it', async () => {
    const config = emptyContract({
      target: postgresTargetPack,
      createNamespace: createTestSqlNamespace,
    });
    const result = await config.source.load(stubContext);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).not.toHaveProperty('defaultControlPolicy');
  });
});
