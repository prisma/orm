import type {
  AuthoringContributions,
  AuthoringTypeNamespace,
} from '@internal/framework-components/authoring';
import { collectScalarTypeConstructors } from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { interpretPslDocumentToSqlContract as interpretPslDocumentToSqlContractInternal } from '../src/interpreter';
import { fixtureDataTypeSupport } from './fixture-data-types';
import {
  postgresScalarAuthoringTypes,
  postgresTarget,
  symbolTableInputFromParseArgs,
} from './fixtures';
import { sqlStorageFromSuccessfulSqlInterpretation } from './interpret-sql-contract-storage';
import { builtinControlMutationDefaults } from './interpreter-defaults-support';

describe('generator defaults never mutate storage — the type position is the only storage decider', () => {
  // Mirrors the adapter contribution shape, with the scalar view derived
  // the same way the provider derives it (collectScalarTypeConstructors).
  const authoringTypes = {
    ...postgresScalarAuthoringTypes,
    Uuid: { kind: 'typeConstructor', output: { codecId: 'pg/uuid@1', nativeType: 'uuid' } },
    Char: {
      kind: 'typeConstructor',
      args: [{ kind: 'number', name: 'length', integer: true, minimum: 1, optional: true }],
      output: {
        codecId: 'sql/char@1',
        nativeType: 'character',
        typeParams: { length: { kind: 'arg', index: 0 } },
      },
    },
  } satisfies AuthoringTypeNamespace;
  const authoringContributions = {
    entityTypes: {},
    field: {},
    pslBlockDescriptors: {},
    modelAttributes: {},
    type: authoringTypes,
  } satisfies AuthoringContributions;

  const interpret = (schema: string) =>
    interpretPslDocumentToSqlContractInternal({
      dataTypeLookup: fixtureDataTypeSupport.lookup,
      ...symbolTableInputFromParseArgs({ schema, sourceId: 'schema.prisma' }),
      target: postgresTarget,
      scalarColumnDescriptors: collectScalarTypeConstructors(authoringTypes),
      authoringContributions,
      composedExtensionContracts: new Map(),
      controlMutationDefaults: builtinControlMutationDefaults,
      createNamespace: createTestSqlNamespace,
      capabilities: { sql: { scalarList: true } },
    });

  it('keeps pg/uuid@1 for a bare native scalar field under @default(uuid())', () => {
    const result = interpret(`model F {
id Uuid @id @default(uuid())
}`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
    expect(storage.namespaces['public']?.entries.table?.['F']?.columns['id']).toEqual({
      codecId: 'pg/uuid@1',
      nativeType: 'uuid',
      nullable: false,
    });
    expect(result.value.execution?.mutations.defaults).toEqual([
      {
        ref: { namespace: 'public', table: 'F', column: 'id' },
        onCreate: { kind: 'generator', id: 'uuidv4' },
      },
    ]);
  });

  it('keeps pg/uuid@1 for a named type aliasing the native scalar under @default(uuid())', () => {
    const result = interpret(`types {
TUuid = Uuid
}

model E {
id TUuid @id @default(uuid())
}`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
    expect(storage.namespaces['public']?.entries.table?.['E']?.columns['id']).toEqual({
      codecId: 'pg/uuid@1',
      nativeType: 'uuid',
      nullable: false,
      typeRef: 'TUuid',
    });
  });

  it('keeps explicit char storage for a constructor-form field under a non-uuid generator default', () => {
    const result = interpret(`model M {
id Char(30) @id @default(cuid(2))
}`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
    expect(storage.namespaces['public']?.entries.table?.['M']?.columns['id']).toEqual({
      codecId: 'sql/char@1',
      nativeType: 'character',
      nullable: false,
      typeParams: { length: 30 },
    });
    expect(result.value.execution?.mutations.defaults).toEqual([
      {
        ref: { namespace: 'public', table: 'M', column: 'id' },
        onCreate: { kind: 'generator', id: 'cuid2' },
      },
    ]);
  });

  it('keeps the target String storage (text) for String under @default(uuid()) and emits the uuidv4 execution default', () => {
    const result = interpret(`model L {
id String @id @default(uuid())
}`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
    expect(storage.namespaces['public']?.entries.table?.['L']?.columns['id']).toEqual({
      codecId: 'pg/text@1',
      nativeType: 'text',
      nullable: false,
    });
    expect(result.value.execution?.mutations.defaults).toEqual([
      {
        ref: { namespace: 'public', table: 'L', column: 'id' },
        onCreate: { kind: 'generator', id: 'uuidv4' },
      },
    ]);
  });

  it('lowers the zero-arg call form String() identically to bare String under @default(uuid())', () => {
    const result = interpret(`model P {
id String() @id @default(uuid())
}`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
    expect(storage.namespaces['public']?.entries.table?.['P']?.columns['id']).toEqual({
      codecId: 'pg/text@1',
      nativeType: 'text',
      nullable: false,
    });
  });

  it('keeps text storage for nanoid and cuid generator defaults on String fields', () => {
    const result = interpret(`model N {
id String @id @default(nanoid())
sized String @default(nanoid(16))
ref String @default(cuid(2))
}`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
    const columns = storage.namespaces['public']?.entries.table?.['N']?.columns;
    expect(columns?.['id']).toEqual({
      codecId: 'pg/text@1',
      nativeType: 'text',
      nullable: false,
    });
    expect(columns?.['sized']).toEqual({
      codecId: 'pg/text@1',
      nativeType: 'text',
      nullable: false,
    });
    expect(columns?.['ref']).toEqual({
      codecId: 'pg/text@1',
      nativeType: 'text',
      nullable: false,
    });
    expect(result.value.execution?.mutations.defaults).toEqual(
      expect.arrayContaining([
        {
          ref: { namespace: 'public', table: 'N', column: 'sized' },
          onCreate: { kind: 'generator', id: 'nanoid', params: { size: 16 } },
        },
      ]),
    );
  });

  it('keeps text storage for a named type aliasing String under @default(uuid())', () => {
    const result = interpret(`types {
TId = String
}

model T {
id TId @id @default(uuid())
}`);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
    expect(storage.namespaces['public']?.entries.table?.['T']?.columns['id']).toEqual({
      codecId: 'pg/text@1',
      nativeType: 'text',
      nullable: false,
      typeRef: 'TId',
    });
  });

  it('diagnoses a generator on a codec outside its applicableCodecIds (Int @default(uuid()))', () => {
    const result = interpret(`model B {
id Int @id @default(uuid())
}`);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_DEFAULT_APPLICABILITY',
          sourceId: 'schema.prisma',
          message: expect.stringContaining('uuidv4'),
        }),
      ]),
    );
  });
});
