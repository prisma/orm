import type { Contract } from '@internal/contract/types';
import { ok } from '@internal/utils/result';
import { describe, expect, it, vi } from 'vitest';
import { collectConfigIssues } from '../src/config-validation';

function createSourceProvider(overrides: Record<string, unknown> = {}) {
  return {
    load: async () => ok({ targetFamily: 'sql' } as Contract),
    ...overrides,
  };
}

type RawConfigOverrides = Record<string, unknown> & {
  family?: Record<string, unknown>;
  target?: Record<string, unknown>;
  adapter?: Record<string, unknown>;
  driver?: Record<string, unknown>;
};

function createValidRawConfig(overrides: RawConfigOverrides = {}) {
  const { family, target, adapter, driver, ...rest } = overrides;

  return {
    family: {
      kind: 'family',
      id: 'sql',
      familyId: 'sql',
      version: '0.0.1',
      manifest: {},
      emission: {},
      create: vi.fn(),
      ...(family as Record<string, unknown> | undefined),
    },
    target: {
      kind: 'target',
      familyId: 'sql',
      targetId: 'postgres',
      id: 'postgres',
      version: '0.0.1',
      manifest: {},
      create: vi.fn(),
      ...(target as Record<string, unknown> | undefined),
    },
    adapter: {
      kind: 'adapter',
      familyId: 'sql',
      targetId: 'postgres',
      id: 'postgres',
      version: '0.0.1',
      manifest: {},
      create: vi.fn(),
      ...(adapter as Record<string, unknown> | undefined),
    },
    driver: {
      kind: 'driver',
      familyId: 'sql',
      targetId: 'postgres',
      id: 'postgres',
      version: '0.0.1',
      manifest: {},
      create: vi.fn(),
      ...(driver as Record<string, unknown> | undefined),
    },
    ...rest,
  };
}

function expectIssue(config: Record<string, unknown>, field: string, section: string) {
  const issues = collectConfigIssues(config);
  expect(issues).toContainEqual(expect.objectContaining({ field, section }));
}

describe('collectConfigIssues', () => {
  it('returns no issues for a valid config', () => {
    expect(collectConfigIssues(createValidRawConfig())).toEqual([]);
  });

  it('reports each missing top-level descriptor under its own section', () => {
    const issues = collectConfigIssues({});
    expect(issues).toEqual([
      { section: 'family', field: 'family', message: 'Config must have a "family" field' },
      { section: 'target', field: 'target', message: 'Config must have a "target" field' },
      { section: 'adapter', field: 'adapter', message: 'Config must have a "adapter" field' },
    ]);
  });

  it('reports one object-type issue per section holding a non-object', () => {
    const issues = collectConfigIssues({
      ...createValidRawConfig(),
      family: 'sql',
      target: 'postgres',
      adapter: 42,
      driver: true,
    });

    expect(issues).toEqual([
      { section: 'family', field: 'family', message: 'Config.family must be an object' },
      { section: 'target', field: 'target', message: 'Config.target must be an object' },
      { section: 'adapter', field: 'adapter', message: 'Config.adapter must be an object' },
      { section: 'driver', field: 'driver', message: 'Config.driver must be an object' },
    ]);
  });

  it('reports a broken family without hiding issues in other sections', () => {
    const issues = collectConfigIssues(
      createValidRawConfig({
        family: { kind: 'invalid' },
        target: { targetId: 123 },
      }),
    );

    expect(issues).toContainEqual(expect.objectContaining({ section: 'family' }));
    expect(issues).toContainEqual(
      expect.objectContaining({ section: 'target', field: 'target.targetId' }),
    );
  });

  it('collects family descriptor field issues', () => {
    expectIssue(createValidRawConfig({ family: { kind: 'invalid' } }), 'family.kind', 'family');
    expectIssue(createValidRawConfig({ family: { id: 123 } }), 'family.id', 'family');
    expectIssue(createValidRawConfig({ family: { familyId: 123 } }), 'family.familyId', 'family');
    expectIssue(createValidRawConfig({ family: { version: 123 } }), 'family.version', 'family');
    expectIssue(
      createValidRawConfig({ family: { emission: undefined } }),
      'family.emission',
      'family',
    );
    expectIssue(createValidRawConfig({ family: { create: 'invalid' } }), 'family.create', 'family');
  });

  it('collects target descriptor field issues', () => {
    expectIssue(createValidRawConfig({ target: { kind: 'invalid' } }), 'target.kind', 'target');
    expectIssue(createValidRawConfig({ target: { id: 123 } }), 'target.id', 'target');
    expectIssue(createValidRawConfig({ target: { familyId: 123 } }), 'target.familyId', 'target');
    expectIssue(createValidRawConfig({ target: { version: 123 } }), 'target.version', 'target');
    expectIssue(createValidRawConfig({ target: { targetId: 123 } }), 'target.targetId', 'target');
    expectIssue(createValidRawConfig({ target: { create: 'invalid' } }), 'target.create', 'target');
  });

  it('reports a family mismatch on the target section', () => {
    expectIssue(
      createValidRawConfig({
        family: { familyId: 'sql' },
        target: { familyId: 'document' },
      }),
      'target.familyId',
      'target',
    );
  });

  it('skips the family mismatch check when the family id itself is invalid', () => {
    const issues = collectConfigIssues(
      createValidRawConfig({
        family: { familyId: 123 },
        target: { familyId: 'document' },
      }),
    );

    expect(issues).toContainEqual(expect.objectContaining({ field: 'family.familyId' }));
    expect(issues).not.toContainEqual(expect.objectContaining({ field: 'target.familyId' }));
  });

  it('collects adapter descriptor field and compatibility issues', () => {
    expectIssue(createValidRawConfig({ adapter: { kind: 'invalid' } }), 'adapter.kind', 'adapter');
    expectIssue(createValidRawConfig({ adapter: { id: 123 } }), 'adapter.id', 'adapter');
    expectIssue(
      createValidRawConfig({ adapter: { familyId: 'document' } }),
      'adapter.familyId',
      'adapter',
    );
    expectIssue(
      createValidRawConfig({ adapter: { targetId: 'mysql' } }),
      'adapter.targetId',
      'adapter',
    );
    expectIssue(
      createValidRawConfig({ adapter: { create: 'invalid' } }),
      'adapter.create',
      'adapter',
    );
  });

  it('collects driver descriptor field and compatibility issues', () => {
    expectIssue(createValidRawConfig({ driver: { kind: 'invalid' } }), 'driver.kind', 'driver');
    expectIssue(createValidRawConfig({ driver: { id: 123 } }), 'driver.id', 'driver');
    expectIssue(createValidRawConfig({ driver: { version: 123 } }), 'driver.version', 'driver');
    expectIssue(
      createValidRawConfig({ driver: { familyId: 'document' } }),
      'driver.familyId',
      'driver',
    );
    expectIssue(
      createValidRawConfig({ driver: { targetId: 'mysql' } }),
      'driver.targetId',
      'driver',
    );
    expectIssue(createValidRawConfig({ driver: { create: 'invalid' } }), 'driver.create', 'driver');
  });

  it('collects extension issues under the extensions section', () => {
    expectIssue(createValidRawConfig({ extensions: 'invalid' }), 'extensions', 'extensions');
    expectIssue(createValidRawConfig({ extensions: ['invalid'] }), 'extensions[]', 'extensions');
    expectIssue(
      createValidRawConfig({
        extensions: [{ kind: 'invalid', id: 'ext', familyId: 'sql', targetId: 'postgres' }],
      }),
      'extensions[].kind',
      'extensions',
    );
    expectIssue(
      createValidRawConfig({
        extensions: [
          {
            kind: 'extension',
            id: 'ext',
            familyId: 'sql',
            targetId: 'mysql',
            version: '0.0.1',
            create: vi.fn(),
          },
        ],
      }),
      'extensions[].targetId',
      'extensions',
    );
  });

  it('reports the removed extensionPacks key under the extensions section', () => {
    const issues = collectConfigIssues(createValidRawConfig({ extensionPacks: [] }));
    expect(issues).toContainEqual(
      expect.objectContaining({
        section: 'extensions',
        field: 'extensionPacks',
        message: expect.stringContaining('rename it to Config.extensions'),
      }),
    );
  });

  it('collects contract issues under the contract section', () => {
    expectIssue(createValidRawConfig({ contract: 'invalid' }), 'contract', 'contract');
    expectIssue(createValidRawConfig({ contract: {} }), 'contract.source', 'contract');
    expectIssue(
      createValidRawConfig({ contract: { source: {} } }),
      'contract.source.load',
      'contract',
    );
    expectIssue(
      createValidRawConfig({ contract: { source: { load: 'invalid' } } }),
      'contract.source.load',
      'contract',
    );
    expectIssue(
      createValidRawConfig({
        contract: { source: createSourceProvider({ inputs: 123 }) },
      }),
      'contract.source.inputs',
      'contract',
    );
    expectIssue(
      createValidRawConfig({
        contract: { source: createSourceProvider({ inputs: ['valid', 123] }) },
      }),
      'contract.source.inputs[]',
      'contract',
    );
    expectIssue(
      createValidRawConfig({
        contract: { source: createSourceProvider({ format: 123 }) },
      }),
      'contract.source.format',
      'contract',
    );
    expectIssue(
      createValidRawConfig({
        contract: { source: createSourceProvider(), output: 123 },
      }),
      'contract.output',
      'contract',
    );
  });

  it('ignores inherited contract keys', () => {
    const inheritedSourceContract = Object.create({
      source: createSourceProvider(),
    }) as Record<string, unknown>;
    expectIssue(
      createValidRawConfig({ contract: inheritedSourceContract }),
      'contract.source',
      'contract',
    );

    const inheritedOutputContract = Object.create(
      { output: 123 },
      { source: { value: createSourceProvider(), enumerable: true } },
    ) as Record<string, unknown>;
    expect(
      collectConfigIssues(createValidRawConfig({ contract: inheritedOutputContract })),
    ).toEqual([]);
  });

  it('accepts inputs entries that are glob patterns, not just literal paths', () => {
    const issues = collectConfigIssues(
      createValidRawConfig({
        contract: {
          source: createSourceProvider({ inputs: ['./prisma/**/*.prisma', './extra.prisma'] }),
        },
      }),
    );
    expect(issues).toEqual([]);
  });

  it('accepts a provider with an unknown format string and extra keys', () => {
    const issues = collectConfigIssues(
      createValidRawConfig({
        contract: {
          source: createSourceProvider({
            format: 'made-up-format',
            inputs: ['./schema.prisma'],
            interpret: () => [],
          }),
        },
      }),
    );
    expect(issues).toEqual([]);
  });

  it('collects migrations issues under the migrations section', () => {
    expectIssue(createValidRawConfig({ migrations: 'invalid' }), 'migrations', 'migrations');
    expectIssue(createValidRawConfig({ migrations: { dir: 123 } }), 'migrations.dir', 'migrations');
    expect(collectConfigIssues(createValidRawConfig({ migrations: {} }))).toEqual([]);
    expect(collectConfigIssues(createValidRawConfig({ migrations: { dir: 'moves' } }))).toEqual([]);
  });

  it('collects formatter issues under the formatter section', () => {
    expectIssue(createValidRawConfig({ formatter: 'invalid' }), 'formatter', 'formatter');
    expectIssue(
      createValidRawConfig({ formatter: { indent: 0 } }),
      'formatter.indent',
      'formatter',
    );
    expectIssue(
      createValidRawConfig({ formatter: { indent: -1 } }),
      'formatter.indent',
      'formatter',
    );
    expectIssue(
      createValidRawConfig({ formatter: { indent: 1.5 } }),
      'formatter.indent',
      'formatter',
    );
    expectIssue(
      createValidRawConfig({ formatter: { indent: 'spaces' } }),
      'formatter.indent',
      'formatter',
    );
    expectIssue(
      createValidRawConfig({ formatter: { newline: 'crlf' } }),
      'formatter.newline',
      'formatter',
    );
    expect(collectConfigIssues(createValidRawConfig({ formatter: {} }))).toEqual([]);
    expect(
      collectConfigIssues(createValidRawConfig({ formatter: { indent: 4, newline: 'CRLF' } })),
    ).toEqual([]);
    expect(collectConfigIssues(createValidRawConfig({ formatter: { indent: 'tab' } }))).toEqual([]);
  });

  it('accepts descriptors without manifest fields', () => {
    const config = createValidRawConfig({
      family: { manifest: undefined },
      target: { manifest: undefined },
      adapter: { manifest: undefined },
      driver: { manifest: undefined },
      extensions: [
        {
          kind: 'extension',
          id: 'pgvector',
          familyId: 'sql',
          targetId: 'postgres',
          version: '0.0.1',
          manifest: undefined,
          create: vi.fn(),
        },
      ],
    });

    expect(collectConfigIssues(config)).toEqual([]);
  });
});
