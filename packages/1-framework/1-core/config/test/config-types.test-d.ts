import type {
  ControlAdapterDescriptor,
  ControlDriverDescriptor,
  ControlDriverInstance,
  ControlExtensionDescriptor,
  ControlFamilyDescriptor,
  ControlFamilyInstance,
  ControlTargetDescriptor,
} from '@internal/framework-components/control';
import { ok } from '@internal/utils/result';
import { expectTypeOf, test } from 'vitest';
import { defineConfig, type FormatterConfig, type PrismaNextConfig } from '../src/config-types';
import type {
  ContractSourceDiagnostic,
  ContractSourceFormat,
  ContractSourceProvider,
  OpaqueContractSourceProvider,
  PslContractSourceProvider,
  TypeScriptContractSourceProvider,
} from '../src/contract-source-types';

const mockHook = {
  id: 'sql',
  generateStorageType: () => '{}',
  generateModelStorageType: () => '{}',
  getFamilyImports: () => [] as string[],
  getFamilyTypeAliases: () => '',
  getTypeMapsExpression: () => 'never',
  getContractWrapper: (base: string, tm: string) =>
    `export type Contract = ${base} & { typeMaps: ${tm} };`,
};

const sqlFamilyDescriptor: ControlFamilyDescriptor<'sql'> = {
  kind: 'family',
  version: '1',
  id: 'sql',
  familyId: 'sql',
  emission: mockHook,
  create: (_stack) =>
    ({
      familyId: 'sql',
    }) as unknown as ControlFamilyInstance<'sql', unknown>,
};

const postgresTargetDescriptor: ControlTargetDescriptor<'sql', 'postgres'> = {
  kind: 'target',
  version: '1',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  contractSerializer: {
    deserializeContract: (json) => json as never,
    serializeContract: (contract) => contract as never,
  },
  create: () => ({
    familyId: 'sql',
    targetId: 'postgres',
  }),
};

const postgresAdapterDescriptor: ControlAdapterDescriptor<'sql', 'postgres'> = {
  kind: 'adapter',
  version: '1',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  create: () => ({
    familyId: 'sql',
    targetId: 'postgres',
  }),
};

const postgresDriverDescriptor: ControlDriverDescriptor<'sql', 'postgres'> = {
  kind: 'driver',
  version: '1',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  create: async () =>
    ({
      familyId: 'sql',
      targetId: 'postgres',
      query: async () => ({ rows: [] }),
      close: async () => {},
    }) as ControlDriverInstance<'sql', 'postgres'>,
};

const postgresExtensionDescriptor: ControlExtensionDescriptor<'sql', 'postgres'> = {
  kind: 'extension',
  version: '1',
  id: 'pgvector',
  familyId: 'sql',
  targetId: 'postgres',
  create: () => ({
    familyId: 'sql',
    targetId: 'postgres',
  }),
};

test('accepts compatible control descriptors', () => {
  const config: PrismaNextConfig<'sql', 'postgres'> = {
    family: sqlFamilyDescriptor,
    target: postgresTargetDescriptor,
    adapter: postgresAdapterDescriptor,
    driver: postgresDriverDescriptor,
    extensions: [postgresExtensionDescriptor],
  };

  const result = defineConfig(config);
  expectTypeOf(result).toExtend<PrismaNextConfig<'sql', 'postgres'>>();
});

test('accepts contract source providers with declared inputs', () => {
  const config: PrismaNextConfig<'sql', 'postgres'> = {
    family: sqlFamilyDescriptor,
    target: postgresTargetDescriptor,
    adapter: postgresAdapterDescriptor,
    contract: {
      source: {
        format: 'psl',
        inputs: ['./schema.prisma'],
        load: async (_context) => ok({} as never),
      },
    },
  };

  const result = defineConfig(config);
  expectTypeOf(result.contract!.source.format).toEqualTypeOf<string | undefined>();
  expectTypeOf(result.contract!.source.inputs).toEqualTypeOf<readonly string[] | undefined>();
  expectTypeOf(result.contract!.source.load).toEqualTypeOf<ContractSourceProvider['load']>();
});

test('source diagnostics require a filename but not a span', () => {
  const diagnostic: ContractSourceDiagnostic = {
    code: 'PSL_PARSE_ERROR',
    message: 'Unexpected token',
    sourceId: 'schema.prisma',
  };
  expectTypeOf(diagnostic.sourceId).toEqualTypeOf<string>();

  // @ts-expect-error every source diagnostic requires a filename
  const missingFilename: ContractSourceDiagnostic = {
    code: 'PSL_PARSE_ERROR',
    message: 'Unexpected token',
  };
  void missingFilename;
});

test('contract source providers form a format-keyed union', () => {
  expectTypeOf<ContractSourceProvider>().toEqualTypeOf<
    PslContractSourceProvider | TypeScriptContractSourceProvider | OpaqueContractSourceProvider
  >();
  expectTypeOf<PslContractSourceProvider['format']>().toEqualTypeOf<'psl'>();
  expectTypeOf<TypeScriptContractSourceProvider['format']>().toEqualTypeOf<'typescript'>();
  expectTypeOf<OpaqueContractSourceProvider['format']>().toEqualTypeOf<string | undefined>();
  expectTypeOf<PslContractSourceProvider['format']>().toExtend<ContractSourceFormat>();
  expectTypeOf<TypeScriptContractSourceProvider['format']>().toExtend<ContractSourceFormat>();
});

test('provider literals remain assignable to the union without casts', () => {
  const load: ContractSourceProvider['load'] = async (_context) => ok({} as never);

  const psl: ContractSourceProvider = {
    format: 'psl',
    inputs: ['./schema.prisma'],
    load,
  };
  const typescript: ContractSourceProvider = { format: 'typescript', load };
  const absent: ContractSourceProvider = { load };
  const thirdParty: ContractSourceProvider = { format: 'made-up-format', load };

  expectTypeOf(psl).toExtend<ContractSourceProvider>();
  expectTypeOf(typescript).toExtend<ContractSourceProvider>();
  expectTypeOf(absent).toExtend<ContractSourceProvider>();
  expectTypeOf(thirdParty).toExtend<ContractSourceProvider>();
});

test('carries an optional formatter section', () => {
  const config: PrismaNextConfig<'sql', 'postgres'> = {
    family: sqlFamilyDescriptor,
    target: postgresTargetDescriptor,
    adapter: postgresAdapterDescriptor,
    formatter: { indent: 'tab', newline: 'CRLF' },
  };

  const result = defineConfig(config);
  expectTypeOf(result.formatter).toEqualTypeOf<FormatterConfig | undefined>();
  expectTypeOf<FormatterConfig['indent']>().toEqualTypeOf<number | 'tab' | undefined>();
  expectTypeOf<FormatterConfig['newline']>().toEqualTypeOf<'LF' | 'CRLF' | undefined>();
});

test('omits the formatter section when absent', () => {
  const config: PrismaNextConfig<'sql', 'postgres'> = {
    family: sqlFamilyDescriptor,
    target: postgresTargetDescriptor,
    adapter: postgresAdapterDescriptor,
  };

  expectTypeOf(config.formatter).toEqualTypeOf<FormatterConfig | undefined>();
});

test('rejects an invalid newline literal in the formatter section', () => {
  const config: PrismaNextConfig<'sql', 'postgres'> = {
    family: sqlFamilyDescriptor,
    target: postgresTargetDescriptor,
    adapter: postgresAdapterDescriptor,
    // @ts-expect-error newline must be 'LF' | 'CRLF', not a lowercase variant
    formatter: { newline: 'crlf' },
  };

  void config;
});

test('rejects mismatched target in target descriptor', () => {
  const mysqlTargetDescriptor: ControlTargetDescriptor<'sql', 'mysql'> = {
    kind: 'target',
    version: '1',
    id: 'mysql',
    familyId: 'sql',
    targetId: 'mysql',
    contractSerializer: {
      deserializeContract: (json) => json as never,
      serializeContract: (contract) => contract as never,
    },
    create: () => ({
      familyId: 'sql',
      targetId: 'mysql',
    }),
  };

  const config: PrismaNextConfig<'sql', 'postgres'> = {
    family: sqlFamilyDescriptor,
    // @ts-expect-error targetId mismatch
    target: mysqlTargetDescriptor,
    adapter: postgresAdapterDescriptor,
  };

  void config;
});

test('rejects mismatched target in adapter descriptor', () => {
  const mysqlAdapterDescriptor: ControlAdapterDescriptor<'sql', 'mysql'> = {
    kind: 'adapter',
    version: '1',
    id: 'mysql',
    familyId: 'sql',
    targetId: 'mysql',
    create: () => ({
      familyId: 'sql',
      targetId: 'mysql',
    }),
  };

  const config: PrismaNextConfig<'sql', 'postgres'> = {
    family: sqlFamilyDescriptor,
    target: postgresTargetDescriptor,
    // @ts-expect-error targetId mismatch
    adapter: mysqlAdapterDescriptor,
  };

  void config;
});
