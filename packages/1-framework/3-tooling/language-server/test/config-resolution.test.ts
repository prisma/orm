import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import type { PrismaNextConfig } from '@internal/config-loader';
import * as configLoader from '@internal/config-loader';
import {
  type CliStructuredError,
  errorConfigValidation,
  errorUnexpected,
} from '@internal/errors/control';
import type { AuthoringPslBlockDescriptorNamespace } from '@internal/framework-components/authoring';
import type { ControlStack } from '@internal/framework-components/control';
import * as control from '@internal/framework-components/control';
import { notOk, ok } from '@internal/utils/result';
import { timeouts } from '@repo/test-utils';
import { join } from 'pathe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveConfigInputs } from '../src/config-resolution';

vi.mock('@internal/config-loader', { spy: true });
vi.mock('@internal/framework-components/control', { spy: true });

function mockLoadedConfig(
  config: PrismaNextConfig,
  diagnostics: readonly CliStructuredError[] = [],
): void {
  vi.spyOn(configLoader, 'loadConfig').mockResolvedValue(ok({ config, diagnostics }));
}

function mockLoadFailure(failure: CliStructuredError): void {
  vi.spyOn(configLoader, 'loadConfig').mockResolvedValue(notOk(failure));
}

function loadedConfig(format: string, inputs: readonly string[]): PrismaNextConfig {
  return { contract: { source: { format, inputs } } } as unknown as PrismaNextConfig;
}

function interpretCapableConfig(inputs: readonly string[]): PrismaNextConfig {
  return {
    contract: {
      source: {
        format: 'psl',
        inputs,
        load: async () => ({}) as never,
        interpret: () => ({}) as never,
      },
    },
  } as unknown as PrismaNextConfig;
}

function stubStackWithContext(): ControlStack {
  return {
    extensions: [{ id: 'ext-a' }, { id: 'ext-b' }],
    extensionContracts: new Map([['ext-a', { targetFamily: 'demo' }]]),
    scalarTypes: ['Int'],
    authoringContributions: {
      field: {},
      type: {
        Int: { kind: 'typeConstructor', output: { codecId: 'demo/int@1', nativeType: 'int' } },
      },
      entityTypes: {},
      pslBlockDescriptors: {},
      modelAttributes: {},
      attributeSpecs: { model: {}, field: {} },
    },
    codecLookup: { get: () => undefined },
    controlMutationDefaults: {
      defaultFunctionRegistry: new Map(),
      generatorDescriptors: [],
    },
    capabilities: { demo: { scalarList: true } },
  } as unknown as ControlStack;
}

function stubStack(
  scalarTypes: readonly string[],
  pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace,
): ControlStack {
  return {
    scalarTypes,
    authoringContributions: { pslBlockDescriptors },
  } as unknown as ControlStack;
}

describe('resolveConfigInputs', { timeout: timeouts.coldTransformImport }, () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('rejects when no config exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pn-lsp-noconfig-'));
    const configPath = join(root, 'prisma.config.ts');

    await expect(resolveConfigInputs(configPath)).rejects.toMatchObject({
      name: 'CliStructuredError',
      code: 'CONFIG.FILE_NOT_FOUND',
    });
  });

  it('rejects when the contract section the project needs is invalid', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pn-lsp-badcontract-'));
    const configPath = join(root, 'prisma.config.ts');
    await writeFile(
      configPath,
      "const orm = { contract: { source: { format: 'psl', inputs: ['./schema.psl'] }, output: './contract.json' } };\n" +
        'export default { $prismaConfig: 1, orm };\n',
    );

    await expect(resolveConfigInputs(configPath)).rejects.toMatchObject({
      name: 'CliStructuredError',
      code: 'CONFIG.VALIDATION_FAILED',
    });
  });

  it('resolves a typescript contract project whose control sections are invalid', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pn-lsp-tscontract-'));
    const configPath = join(root, 'prisma.config.ts');
    await writeFile(
      configPath,
      'const orm = {\n' +
        '  family: {},\n' +
        "  contract: { source: { format: 'typescript', inputs: ['./contract.ts'], load: async () => ({}) }, output: './contract.json' },\n" +
        '};\n' +
        'export default { $prismaConfig: 1, orm };\n',
    );

    const result = await resolveConfigInputs(configPath);

    expect(result.controlStack).toEqual({ scalarTypes: [], pslBlockDescriptors: {} });
  });

  it('rejects a config that was not created by defineConfig', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pn-lsp-unmarked-'));
    const configPath = join(root, 'prisma.config.ts');
    await writeFile(configPath, 'export default { family: {} };\n');

    await expect(resolveConfigInputs(configPath)).rejects.toMatchObject({
      name: 'CliStructuredError',
      code: 'CONFIG.VERSION_MARKER_MISSING',
    });
  });

  it('re-throws unexpected structured errors', async () => {
    mockLoadFailure(errorUnexpected('boom', { why: 'Failed to load config: boom' }));
    const root = await mkdtemp(join(tmpdir(), 'pn-lsp-unexpected-'));
    const configPath = join(root, 'prisma.config.ts');

    await expect(resolveConfigInputs(configPath)).rejects.toMatchObject({
      name: 'CliStructuredError',
      code: 'CLI.UNEXPECTED',
    });
  });

  it('resolves a typescript contract project despite a diagnostic on a control section', async () => {
    mockLoadedConfig(loadedConfig('typescript', ['/abs/contract.ts']), [
      errorConfigValidation('target.targetId', {
        why: 'Config.target must have targetId: string',
        section: 'target',
      }),
    ]);

    const result = await resolveConfigInputs('/abs/prisma.config.ts');

    expect(result.controlStack).toEqual({ scalarTypes: [], pslBlockDescriptors: {} });
  });

  it('rejects a psl project carrying the same control-section diagnostic', async () => {
    mockLoadedConfig(loadedConfig('psl', ['/abs/schema.psl']), [
      errorConfigValidation('target.targetId', {
        why: 'Config.target must have targetId: string',
        section: 'target',
      }),
    ]);

    await expect(resolveConfigInputs('/abs/prisma.config.ts')).rejects.toMatchObject({
      name: 'CliStructuredError',
      code: 'CONFIG.VALIDATION_FAILED',
    });
  });

  it('rejects a typescript contract project carrying a contract-section diagnostic', async () => {
    mockLoadedConfig(loadedConfig('typescript', ['/abs/contract.ts']), [
      errorConfigValidation('contract.source.load', {
        why: 'Config.contract.source.load must be a function',
        section: 'contract',
      }),
    ]);

    await expect(resolveConfigInputs('/abs/prisma.config.ts')).rejects.toMatchObject({
      name: 'CliStructuredError',
      code: 'CONFIG.VALIDATION_FAILED',
    });
  });

  it('surfaces the control-stack-derived inputs for a psl config', async () => {
    mockLoadedConfig(loadedConfig('psl', ['/abs/schema.psl']));
    vi.spyOn(control, 'createControlStack').mockReturnValue(stubStack(['Int'], {}));

    const result = await resolveConfigInputs('/abs/prisma.config.ts');

    expect(result.controlStack).toEqual({ scalarTypes: ['Int'], pslBlockDescriptors: {} });
    expect(result.inputs.includes(pathToFileURL('/abs/schema.psl').toString())).toBe(true);
  });
});

describe('control-stack input derivation', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('never builds a stack for a non-psl source and derives empty pipeline inputs', async () => {
    mockLoadedConfig(loadedConfig('typescript', ['/abs/schema.psl']));
    const createControlStack = vi.spyOn(control, 'createControlStack');

    const result = await resolveConfigInputs('/abs/prisma.config.ts');

    expect(result.controlStack).toEqual({ scalarTypes: [], pslBlockDescriptors: {} });
    expect(createControlStack).not.toHaveBeenCalled();
  });

  it('derives control-stack scalarTypes and pslBlockDescriptors for a psl source', async () => {
    const pslBlockDescriptors: AuthoringPslBlockDescriptorNamespace = {
      enum: {
        kind: 'pslBlock',
        keyword: 'enum',
        discriminator: 'enum',
        name: { required: true },
        parameters: {},
        variadicParameters: true,
      },
    };
    mockLoadedConfig(loadedConfig('psl', ['/abs/schema.psl']));
    vi.spyOn(control, 'createControlStack').mockReturnValue(
      stubStack(['Int', 'String'], pslBlockDescriptors),
    );

    const result = await resolveConfigInputs('/abs/prisma.config.ts');

    expect(result.controlStack).toEqual({ scalarTypes: ['Int', 'String'], pslBlockDescriptors });
  });

  it('propagates createControlStack failures for a psl source', async () => {
    mockLoadedConfig(loadedConfig('psl', ['/abs/schema.psl']));
    vi.spyOn(control, 'createControlStack').mockImplementation(() => {
      throw new Error('boom');
    });

    await expect(resolveConfigInputs('/abs/prisma.config.ts')).rejects.toThrow('boom');
  });
});

describe('interpretation resolution', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('carries the guarded source and a stack-assembled context for a capable psl config', async () => {
    const config = interpretCapableConfig(['/abs/schema.prisma']);
    const stack = stubStackWithContext();
    mockLoadedConfig(config);
    vi.spyOn(control, 'createControlStack').mockReturnValue(stack);

    const result = await resolveConfigInputs('/abs/prisma.config.ts');

    expect(result.interpretation).toBeDefined();
    expect(result.interpretation?.source).toBe(config.contract?.source);
    const context = result.interpretation?.context;
    expect(context?.composedExtensions).toEqual(['ext-a', 'ext-b']);
    expect(context?.composedExtensionContracts).toBe(stack.extensionContracts);
    expect(context?.authoringContributions).toBe(stack.authoringContributions);
    expect(context?.codecLookup).toBe(stack.codecLookup);
    expect(context?.controlMutationDefaults).toBe(stack.controlMutationDefaults);
    expect(context?.capabilities).toBe(stack.capabilities);
    expect(context?.resolvedInputs).toEqual([pathToFileURL('/abs/schema.prisma').toString()]);
  });

  it('creates the control stack once per resolution', async () => {
    const config = interpretCapableConfig(['/abs/schema.prisma']);
    mockLoadedConfig(config);
    const createControlStack = vi
      .spyOn(control, 'createControlStack')
      .mockReturnValue(stubStackWithContext());

    await resolveConfigInputs('/abs/prisma.config.ts');

    expect(createControlStack).toHaveBeenCalledTimes(1);
  });

  it('carries no interpretation for a typescript source', async () => {
    mockLoadedConfig(loadedConfig('typescript', ['/abs/contract.ts']));

    const result = await resolveConfigInputs('/abs/prisma.config.ts');

    expect(result.interpretation).toBeUndefined();
  });

  it('carries no interpretation for a psl source without the interpret capability', async () => {
    mockLoadedConfig(loadedConfig('psl', ['/abs/schema.prisma']));
    vi.spyOn(control, 'createControlStack').mockReturnValue(stubStack(['Int'], {}));

    const result = await resolveConfigInputs('/abs/prisma.config.ts');

    expect(result.interpretation).toBeUndefined();
  });

  it('carries no interpretation when the config has no contract', async () => {
    mockLoadedConfig({} as unknown as PrismaNextConfig);

    const result = await resolveConfigInputs('/abs/prisma.config.ts');

    expect(result.interpretation).toBeUndefined();
  });
});
