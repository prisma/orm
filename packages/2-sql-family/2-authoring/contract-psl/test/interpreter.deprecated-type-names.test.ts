import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import type {
  AuthoringContributions,
  AuthoringTypeNamespace,
} from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import { fixturePostgresTypeNamespace, postgresNativeScalarTypeDescriptors } from './fixtures';
import {
  builtinControlMutationDefaults,
  interpretPostgresSchema,
} from './interpreter-defaults-support';

const length = { kind: 'value', dataType: 'pg/int4', name: 'length', optional: true } as const;
const varchar = {
  kind: 'typeConstructor',
  args: [length],
  output: { codecId: 'sql/varchar@1', typeParams: { length: { kind: 'arg', index: 0 } } },
} as const;

const types = {
  ...fixturePostgresTypeNamespace,
  Int2: { kind: 'typeConstructor', output: { codecId: 'pg/int2@1' } },
  Varchar: varchar,
  Short: {
    kind: 'typeConstructor',
    output: { codecId: 'pg/int2@1' },
    deprecated: { replacement: 'Int2' },
  },
  VarText: { ...varchar, deprecated: { replacement: 'Varchar' } },
} satisfies AuthoringTypeNamespace;

const authoringContributions = {
  entityTypes: {},
  pslBlockDescriptors: {},
  modelAttributes: {},
  type: types,
  valueObjectStorageType: 'Jsonb',
} satisfies AuthoringContributions;

function interpret(schema: string, reportWarning?: (diagnostic: ContractSourceDiagnostic) => void) {
  return interpretPostgresSchema(schema, {
    scalarColumnDescriptors: postgresNativeScalarTypeDescriptors,
    controlMutationDefaults: builtinControlMutationDefaults,
    authoringContributions,
    ...(reportWarning === undefined ? {} : { reportWarning }),
  });
}

function interpretWithWarnings(schema: string) {
  const warnings: ContractSourceDiagnostic[] = [];
  const result = interpret(schema, (diagnostic) => {
    warnings.push(diagnostic);
  });
  if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics, null, 2));
  return { contract: JSON.stringify(result.value), warnings };
}

const model = (field: string) => `model T {\n  id Int @id\n  value ${field}\n}\n`;

const warningAt = (written: string, replacement: string, line: number, column: number) => ({
  code: 'PSL_DEPRECATED_SCALAR_NAME',
  message: `Scalar type "${written}" is deprecated and will be removed; use "${replacement}".`,
  sourceId: 'schema.prisma',
  span: expect.objectContaining({
    start: expect.objectContaining({ line, column }),
    end: expect.objectContaining({ line, column: column + written.length }),
  }),
  severity: 'warning',
});

describe('a deprecated type name in a SQL schema', () => {
  it.each([
    ['Short', 'Int2', 'Int2'],
    ['VarText(12)', 'Varchar(12)', 'Varchar'],
    ['VarText', 'Varchar', 'Varchar'],
  ])(
    '%s warns at the type, naming its replacement, and emits the contract %s emits',
    (written, current, replacement) => {
      const deprecated = interpretWithWarnings(model(written));
      const replaced = interpretWithWarnings(model(current));
      const name = written.replace(/\(.*$/, '');

      expect(deprecated.warnings).toEqual([warningAt(name, replacement, 3, 9)]);
      expect(replaced.warnings).toEqual([]);
      expect(deprecated.contract).toBe(replaced.contract);
    },
  );

  it('warns at the type of a types {} alias that names it', () => {
    const schema = `types {\n  Code = VarText(3)\n}\n\n${model('Code')}`;
    const { warnings, contract } = interpretWithWarnings(schema);
    expect(warnings).toEqual([warningAt('VarText', 'Varchar', 2, 10)]);
    expect(contract).toBe(
      interpretWithWarnings(`types {\n  Code = Varchar(3)\n}\n\n${model('Code')}`).contract,
    );
  });

  it('warns at the type of a value object member that names it', () => {
    const valueObject = (memberType: string) =>
      `type Money {\n  cents ${memberType}\n}\n\n${model('Money')}`;
    const { warnings, contract } = interpretWithWarnings(valueObject('Short'));
    expect(warnings).toEqual([warningAt('Short', 'Int2', 2, 9)]);
    expect(contract).toBe(interpretWithWarnings(valueObject('Int2')).contract);
  });

  it('is accepted when no warning sink is supplied', () => {
    expect(interpret(model('Short')).ok).toBe(true);
  });
});
