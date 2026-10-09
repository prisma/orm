import { ContractValidationError } from '@internal/contract/contract-validation-error';
import { type ContractModel, type ContractRelation, crossRef } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { computeCheckContentHash } from '@internal/sql-schema-ir/naming';
import { blindCast } from '@internal/utils/casts';
import { createContract } from '@repo/test-utils';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { composeSqlEntityKinds } from '../src/entity-kinds';
import { col, fk, index, model, pk, table, unique } from '../src/factories';
import { CheckConstraint } from '../src/ir/check-constraint';
import { Index } from '../src/ir/sql-index';
import { StorageColumn } from '../src/ir/storage-column';
import { StorageTable } from '../src/ir/storage-table';
import { indexInputFromSerialized, type SerializedIndex } from '../src/serialized-index';
import type { ReferentialAction, SqlModelFieldStorage, SqlStorage } from '../src/types';
import {
  createSqlContractSchema,
  createSqlStorageSchema,
  StorageValueSetSchema,
  validateModel,
  validateSqlContractFully,
  validateSqlStorageConsistency,
  validateStorage,
  validateStorageSemantics,
} from '../src/validators';

/** Routes a stored (flat) index entry through the contract-JSON hydrator. */
function serializedIndex(flat: SerializedIndex): Index {
  return new Index(indexInputFromSerialized(flat));
}

const roleInCheck = `"role" IN ('user', 'admin')`;

function checkConstraint(name: string, expression: string): CheckConstraint {
  return new CheckConstraint({ naming: { kind: 'exact', name }, expression });
}

function wireCheckConstraint(prefix: string, expression: string): CheckConstraint {
  return new CheckConstraint({
    naming: { kind: 'wire', prefix, hash: computeCheckContentHash(expression) },
    expression,
  });
}

function unboundTables<T extends Record<string, unknown>>(tables: T) {
  return {
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: {
        id: UNBOUND_NAMESPACE_ID,
        kind: 'test-sql-namespace',
        entries: { table: tables },
      },
    },
  };
}

// `model()` (src/factories.ts) declares its return `relations` as the loose
// `Record<string, unknown>` — the runtime value always matches the caller's
// literal relations argument, so this wrapper re-asserts the precise type
// for call sites that need `ContractModel`.
function contractModel(
  tableName: string,
  fields: Record<string, SqlModelFieldStorage>,
  relations: Record<string, ContractRelation> = {},
  namespaceId?: string,
): ContractModel {
  return blindCast<
    ContractModel,
    'model() widens `relations` to Record<string, unknown>; the argument here already matches ContractRelation'
  >(model(tableName, fields, relations, namespaceId));
}

describe('SQL contract validators', () => {
  it('normalizes omitted model-field cardinality without changing the input', () => {
    const field = { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false };
    const input = {
      storage: { namespaceId: UNBOUND_NAMESPACE_ID, table: 'Item', fields: {} },
      fields: { name: field },
    };
    expect(validateModel(input)).toEqual({ ...input, fields: { name: { ...field, many: false } } });
    expect(field).not.toHaveProperty('many');
  });

  it.each([
    { metadata: {}, valid: true, many: false },
    { metadata: { many: false }, valid: true, many: false },
    {
      metadata: { many: { elementNullable: false } },
      valid: true,
      many: { elementNullable: false },
    },
    { metadata: { many: { elementNullable: true } }, valid: true, many: { elementNullable: true } },
    { metadata: { many: true }, valid: false, many: undefined },
    { metadata: { many: null }, valid: false, many: undefined },
    { metadata: { many: {} }, valid: false, many: undefined },
    { metadata: { many: { elementNullable: 'false' } }, valid: false, many: undefined },
  ])('validates and normalizes value-object cardinality $metadata', ({ metadata, valid, many }) => {
    const field = { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false, ...metadata };
    const schema = createSqlContractSchema(composeSqlEntityKinds());
    const result = schema({
      target: 'postgres',
      targetFamily: 'sql',
      profileHash: 'test',
      domain: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            models: {},
            valueObjects: { Address: { fields: { city: field } } },
          },
        },
      },
      storage: { storageHash: 'test', namespaces: {} },
    });
    if (valid) {
      expect(result).toMatchObject({
        domain: {
          namespaces: {
            [UNBOUND_NAMESPACE_ID]: {
              valueObjects: { Address: { fields: { city: { ...field, many } } } },
            },
          },
        },
      });
    } else {
      expect(result).toBeInstanceOf(type.errors);
    }
  });

  describe.each(['domain field', 'storage column'])('%s many metadata', (location) => {
    it.each([
      { many: false, valid: true },
      { many: true, valid: false },
      { many: null, valid: false },
      { many: { elementNullable: false }, valid: true },
      { many: { elementNullable: true }, valid: true },
      { many: { elementNullable: false, elementNullabe: true }, valid: false },
      { many: {}, valid: false },
      { many: { elementNullable: 'false' }, valid: false },
    ])('validates $many as $valid', ({ many, valid }) => {
      const validate = () =>
        location === 'domain field'
          ? validateModel({
              storage: { namespaceId: UNBOUND_NAMESPACE_ID, table: 'Item', fields: {} },
              fields: {
                tags: { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false, many },
              },
            })
          : validateStorage({
              storageHash: 'test',
              ...unboundTables({
                Item: {
                  columns: {
                    tags: { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false, many },
                  },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
              }),
            });
      if (valid) {
        expect(validate).not.toThrow();
      } else {
        expect(validate).toThrow();
      }
    });
  });

  describe('validateStorage', () => {
    it('validates valid storage', () => {
      const userTable = table({
        id: col('pg/int4', 'pg/int4@1'),
        email: col('pg/text', 'pg/text@1'),
      });
      const s = createContract<SqlStorage>({
        storage: unboundTables({ user: userTable }),
      }).storage;
      expect(() => validateStorage(s)).not.toThrow();
    });

    it('throws on invalid storage structure', () => {
      const invalid = {
        storageHash: 'test',
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            entries: { table: 'not-an-object' },
          },
        },
      } as unknown;
      expect(() => validateStorage(invalid)).toThrow();
    });

    it('invalid storage error carries CONTRACT.VALIDATION_FAILED', () => {
      const invalid = {
        storageHash: 'test',
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            entries: { table: 'not-an-object' },
          },
        },
      } as unknown;
      expect(() => validateStorage(invalid)).toThrowError(
        expect.objectContaining({ code: 'CONTRACT.VALIDATION_FAILED' }) as unknown as Error,
      );
    });

    it('throws on invalid table structure', () => {
      const invalid = {
        storageHash: 'test',
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            entries: {
              table: {
                user: {
                  columns: 'not-an-object',
                },
              },
            },
          },
        },
      } as unknown;
      expect(() => validateStorage(invalid)).toThrow();
    });

    it('throws on a data type that is not a string', () => {
      const invalid = {
        storageHash: 'test',
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            entries: {
              table: {
                user: {
                  columns: {
                    id: { dataType: 123, codecId: 'pg/int4@1', nullable: false },
                  },
                },
              },
            },
          },
        },
      } as unknown;
      expect(() => validateStorage(invalid)).toThrow();
    });

    it('throws on invalid nullable type', () => {
      const invalid = {
        storageHash: 'test',
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            entries: {
              table: {
                user: {
                  columns: {
                    id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: 'yes' },
                  },
                },
              },
            },
          },
        },
      } as unknown;
      expect(() => validateStorage(invalid)).toThrow();
    });

    it('throws when column declares both typeParams and typeRef', () => {
      const invalid = {
        storageHash: 'test',
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            entries: {
              table: {
                user: {
                  columns: {
                    embedding: {
                      dataType: 'pgvector/vector',
                      codecId: 'pg/vector@1',
                      nullable: false,
                      typeParams: { dimensions: 1536 },
                      typeRef: 'vector_1536',
                    },
                  },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
              },
            },
          },
        },
      } as unknown;
      expect(() => validateStorage(invalid)).toThrow(/either typeParams or typeRef, not both/);
    });
  });

  describe('the stored data type', () => {
    const columnsPath = `storage.namespaces.${UNBOUND_NAMESPACE_ID}.entries.table.user.columns`;
    const refusal = (path: string) =>
      `${path}.nativeType: contracts no longer store a column's database type name; the column names its data type in "dataType"`;
    const storageWithColumns = (columns: Record<string, Record<string, unknown>>) => ({
      storageHash: 'test',
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: {
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              user: { columns, uniques: [], indexes: [], foreignKeys: [] },
            },
          },
        },
      },
    });
    const storageWithColumn = (column: Record<string, unknown>) =>
      storageWithColumns({ id: column });
    const oldColumns = (count: number) =>
      Object.fromEntries(
        Array.from({ length: count }, (_, index) => [
          `c${index}`,
          { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
        ]),
      );
    const jsonDefaultWithNativeTypeKey = {
      dataType: 'pg/jsonb',
      codecId: 'pg/jsonb@1',
      nullable: false,
      default: { kind: 'literal', value: { nativeType: 'default', nested: [{ nativeType: 1 }] } },
    };

    it('refuses a column that stores its database type name', () => {
      const storage = storageWithColumn({
        nativeType: 'int4',
        codecId: 'pg/int4@1',
        nullable: false,
      });
      expect(() => validateStorage(storage)).toThrowError(
        expect.objectContaining({
          code: 'CONTRACT.VALIDATION_FAILED',
          meta: { errors: [refusal(`${columnsPath}.id`)] },
        }) as unknown as Error,
      );
    });

    it('refuses a storage type that stores its database type name, naming every such key', () => {
      const storage = {
        ...storageWithColumn({ nativeType: 'int4', codecId: 'pg/int4@1', nullable: false }),
        types: {
          Embedding: {
            kind: 'codec-instance',
            codecId: 'pg/vector@1',
            nativeType: 'vector',
            typeParams: { length: 3 },
          },
        },
      };
      expect(() => validateStorage(storage)).toThrowError(
        expect.objectContaining({
          code: 'CONTRACT.VALIDATION_FAILED',
          meta: {
            errors: [refusal(`${columnsPath}.id`), refusal('storage.types.Embedding')],
          },
        }) as unknown as Error,
      );
    });

    it('refuses an old contract through the full validator with the standard code', () => {
      const contract = {
        ...createContract<SqlStorage>({ storage: unboundTables({}) }),
        storage: storageWithColumn({ nativeType: 'int4', codecId: 'pg/int4@1', nullable: false }),
      };
      expect(() => validateSqlContractFully(contract)).toThrowError(
        expect.objectContaining({
          code: 'CONTRACT.VALIDATION_FAILED',
          phase: 'structural',
          message: `Contract structural validation failed: ${refusal(`${columnsPath}.id`)}`,
        }) as unknown as Error,
      );
    });

    it('names the first five paths and the total count when more keys store a database type name', () => {
      const listed = [0, 1, 2, 3, 4].map((index) => refusal(`${columnsPath}.c${index}`));
      expect(() => validateStorage(storageWithColumns(oldColumns(7)))).toThrowError(
        expect.objectContaining({
          code: 'CONTRACT.VALIDATION_FAILED',
          message: `Storage validation failed: ${[...listed, 'and 2 more paths (7 in all)'].join('; ')}`,
        }) as unknown as Error,
      );
    });

    it('names the first five paths and the total count through the full validator', () => {
      const listed = [0, 1, 2, 3, 4].map((index) => refusal(`${columnsPath}.c${index}`));
      const contract = {
        ...createContract<SqlStorage>({ storage: unboundTables({}) }),
        storage: storageWithColumns(oldColumns(6)),
      };
      expect(() => validateSqlContractFully(contract)).toThrowError(
        expect.objectContaining({
          code: 'CONTRACT.VALIDATION_FAILED',
          message: `Contract structural validation failed: ${[...listed, 'and 1 more path (6 in all)'].join('; ')}`,
        }) as unknown as Error,
      );
    });

    it('accepts a JSON default whose document has a nativeType key', () => {
      expect(() => validateStorage(storageWithColumn(jsonDefaultWithNativeTypeKey))).not.toThrow();
    });

    it('accepts a JSON default whose document has a nativeType key through the full validator', () => {
      const contract = {
        ...createContract<SqlStorage>({ storage: unboundTables({}) }),
        storage: storageWithColumn(jsonDefaultWithNativeTypeKey),
      };
      expect(() => validateSqlContractFully(contract)).not.toThrow();
    });

    it('refuses a column without a data type', () => {
      expect(() =>
        validateStorage(storageWithColumn({ codecId: 'pg/int4@1', nullable: false })),
      ).toThrow(/dataType must be/);
    });

    it('refuses a data type that is not a data type id', () => {
      expect(() =>
        validateStorage(
          storageWithColumn({ dataType: 'int4', codecId: 'pg/int4@1', nullable: false }),
        ),
      ).toThrow(/dataType must be/);
    });

    it('accepts a column that names its data type', () => {
      expect(() =>
        validateStorage(
          storageWithColumn({ dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false }),
        ),
      ).not.toThrow();
    });

    it('refuses a storage type without a data type', () => {
      const storage = {
        ...storageWithColumn({ dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false }),
        types: { Embedding: { kind: 'codec-instance', codecId: 'pg/vector@1', typeParams: {} } },
      };
      expect(() => validateStorage(storage)).toThrow(/dataType must be/);
    });
  });

  describe('validateModel', () => {
    it('validates valid model', () => {
      const userModel = model('user', {
        id: { column: 'id' },
        email: { column: 'email' },
      });
      expect(() => validateModel(userModel)).not.toThrow();
    });

    it('throws on invalid model structure', () => {
      const invalid = { storage: 'not-an-object' } as unknown;
      expect(() => validateModel(invalid)).toThrow();
    });

    it('throws on missing storage.table', () => {
      const invalid = {
        storage: {},
        fields: {},
        relations: {},
      } as unknown;
      expect(() => validateModel(invalid)).toThrow();
    });

    it('throws on invalid fields structure', () => {
      const invalid = {
        storage: { table: 'user', namespaceId: UNBOUND_NAMESPACE_ID },
        fields: 'not-an-object',
        relations: {},
      } as unknown;
      expect(() => validateModel(invalid)).toThrow();
    });

    it('validates model without relations', () => {
      const modelWithoutRelations = {
        storage: {
          table: 'user',
          namespaceId: UNBOUND_NAMESPACE_ID,
          fields: { id: { column: 'id' } },
        },
        fields: {
          id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' }, many: false },
        },
      };
      expect(() => validateModel(modelWithoutRelations)).not.toThrow();
    });

    const modelWithRelation = (relation: unknown) => ({
      storage: {
        table: 'parent',
        namespaceId: UNBOUND_NAMESPACE_ID,
        fields: { id: { column: 'id' } },
      },
      fields: {
        id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' }, many: false },
      },
      relations: { rel: relation },
    });

    const through = {
      table: 'parent_child',
      namespaceId: UNBOUND_NAMESPACE_ID,
      parentColumns: ['parent_id'],
      childColumns: ['child_id'],
      targetColumns: ['id'],
    };

    it('validates an N:M relation carrying through', () => {
      const valid = modelWithRelation({
        to: { model: 'Child', namespace: UNBOUND_NAMESPACE_ID },
        cardinality: 'N:M',
        on: { localFields: ['id'], targetFields: ['id'] },
        through,
      });
      expect(() => validateModel(valid)).not.toThrow();
    });

    it('rejects an N:M relation without through', () => {
      const invalid = modelWithRelation({
        to: { model: 'Child', namespace: UNBOUND_NAMESPACE_ID },
        cardinality: 'N:M',
        on: { localFields: ['id'], targetFields: ['id'] },
      });
      expect(() => validateModel(invalid)).toThrow();
    });

    it('rejects a non-N:M relation carrying through', () => {
      const invalid = modelWithRelation({
        to: { model: 'Child', namespace: UNBOUND_NAMESPACE_ID },
        cardinality: 'N:1',
        nullable: false,
        on: { localFields: ['parentId'], targetFields: ['id'] },
        through,
      });
      expect(() => validateModel(invalid)).toThrow();
    });

    it.each(['N:1', '1:1'])('accepts a %s relation with or without nullable', (cardinality) => {
      const withFlag = modelWithRelation({
        to: { model: 'Child', namespace: UNBOUND_NAMESPACE_ID },
        cardinality,
        nullable: true,
        on: { localFields: ['parentId'], targetFields: ['id'] },
      });
      expect(() => validateModel(withFlag)).not.toThrow();
      const withoutFlag = modelWithRelation({
        to: { model: 'Child', namespace: UNBOUND_NAMESPACE_ID },
        cardinality,
        on: { localFields: ['parentId'], targetFields: ['id'] },
      });
      expect(() => validateModel(withoutFlag)).not.toThrow();
    });

    it('rejects a non-boolean nullable on a to-one relation', () => {
      const invalid = modelWithRelation({
        to: { model: 'Child', namespace: UNBOUND_NAMESPACE_ID },
        cardinality: 'N:1',
        nullable: 'yes',
        on: { localFields: ['parentId'], targetFields: ['id'] },
      });
      expect(() => validateModel(invalid)).toThrow(/nullable/);
    });

    it('rejects nullable on a 1:N relation', () => {
      const invalid = modelWithRelation({
        to: { model: 'Child', namespace: UNBOUND_NAMESPACE_ID },
        cardinality: '1:N',
        nullable: true,
        on: { localFields: ['id'], targetFields: ['parentId'] },
      });
      expect(() => validateModel(invalid)).toThrow(/nullable/);
    });
  });

  describe('validateSqlContractFully', () => {
    it('throws ContractValidationError when contract value is not an object', () => {
      try {
        validateSqlContractFully(null);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(ContractValidationError);
        expect((e as ContractValidationError).phase).toBe('structural');
        expect((e as ContractValidationError).code).toBe('CONTRACT.VALIDATION_FAILED');
        expect((e as ContractValidationError).message).toMatch(/value must be an object/);
      }
    });

    it('validates valid contract', () => {
      const userTable = table({
        id: col('pg/int4', 'pg/int4@1'),
        email: col('pg/text', 'pg/text@1'),
      });
      const c = createContract<SqlStorage>({
        storage: unboundTables({ user: userTable }),
        models: {
          User: contractModel('user', {
            id: { column: 'id' },
            email: { column: 'email' },
          }),
        },
      });
      expect(() => validateSqlContractFully(c)).not.toThrow();
    });

    const toOneContract = (input: {
      readonly relation: Partial<ContractRelation>;
      readonly authorIdNullable: boolean;
    }) =>
      createContract<SqlStorage>({
        storage: unboundTables({
          post: table({
            id: col('pg/int4', 'pg/int4@1'),
            author_id: col('pg/int4', 'pg/int4@1', input.authorIdNullable),
          }),
          user: table({ id: col('pg/int4', 'pg/int4@1') }),
        }),
        models: {
          Post: contractModel(
            'post',
            { id: { column: 'id' }, authorId: { column: 'author_id' } },
            {
              author: blindCast<ContractRelation, 'test relation literal'>({
                to: crossRef('User', UNBOUND_NAMESPACE_ID),
                cardinality: 'N:1',
                on: { localFields: ['authorId'], targetFields: ['id'] },
                ...input.relation,
              }),
            },
          ),
          User: contractModel('user', { id: { column: 'id' } }),
        },
      });

    describe('to-one relation nullability against storage', () => {
      it.each([true, false])('accepts nullable: %s when the FK column agrees', (nullable) => {
        const c = toOneContract({ relation: { nullable }, authorIdNullable: nullable });
        expect(() => validateSqlContractFully(c)).not.toThrow();
      });

      it('rejects nullable: true over a NOT NULL FK column, naming the column', () => {
        const c = toOneContract({ relation: { nullable: true }, authorIdNullable: false });
        expect(() => validateSqlContractFully(c)).toThrow(
          expect.objectContaining({
            phase: 'storage',
            message: expect.stringMatching(
              /Relation "author" on model "__unbound__:Post" is nullable but every local FK column is NOT NULL.*"author_id"/,
            ),
          }),
        );
      });

      it('rejects nullable: false over a nullable FK column, naming the column', () => {
        const c = toOneContract({ relation: { nullable: false }, authorIdNullable: true });
        expect(() => validateSqlContractFully(c)).toThrow(
          expect.objectContaining({
            phase: 'storage',
            message: expect.stringMatching(
              /Relation "author" on model "__unbound__:Post" is required but a local FK column is nullable.*"author_id"/,
            ),
          }),
        );
      });

      it('leaves a relation without the flag to hydration', () => {
        const c = toOneContract({ relation: {}, authorIdNullable: true });
        expect(() => validateSqlContractFully(c)).not.toThrow();
      });

      const backSideContract = (
        nullable: boolean,
        layout: 'with-primary-keys' | 'no-primary-keys' = 'with-primary-keys',
      ) =>
        createContract<SqlStorage>({
          storage: unboundTables({
            user: table(
              { id: col('pg/int4', 'pg/int4@1') },
              layout === 'with-primary-keys' ? { pk: pk('id') } : undefined,
            ),
            profile: table(
              { id: col('pg/int4', 'pg/int4@1'), user_id: col('pg/int4', 'pg/int4@1') },
              layout === 'with-primary-keys' ? { pk: pk('id') } : undefined,
            ),
          }),
          models: {
            User: contractModel(
              'user',
              { id: { column: 'id' } },
              {
                profile: blindCast<ContractRelation, 'test relation literal'>({
                  to: crossRef('Profile', UNBOUND_NAMESPACE_ID),
                  cardinality: '1:1',
                  nullable,
                  on: { localFields: ['id'], targetFields: ['userId'] },
                }),
              },
            ),
            Profile: contractModel('profile', {
              id: { column: 'id' },
              userId: { column: 'user_id' },
            }),
          },
        });

      it('accepts nullable: true on the 1:1 side whose local columns are its primary key', () => {
        expect(() => validateSqlContractFully(backSideContract(true))).not.toThrow();
      });

      it('rejects nullable: false on the 1:1 side that does not own the foreign key', () => {
        expect(() => validateSqlContractFully(backSideContract(false))).toThrow(
          expect.objectContaining({
            phase: 'storage',
            message: expect.stringMatching(
              /Relation "profile" on model "__unbound__:User" is required but does not own the foreign key/,
            ),
          }),
        );
      });

      it('accepts nullable: true on a 1:1 side with no primary key and no foreign key', () => {
        expect(() =>
          validateSqlContractFully(backSideContract(true, 'no-primary-keys')),
        ).not.toThrow();
      });

      it('rejects nullable: false on a 1:1 side with no primary key and no foreign key, naming the relation', () => {
        expect(() => validateSqlContractFully(backSideContract(false, 'no-primary-keys'))).toThrow(
          expect.objectContaining({
            phase: 'storage',
            message: expect.stringMatching(
              /Relation "profile" on model "__unbound__:User" is required but does not own the foreign key/,
            ),
          }),
        );
      });

      const owningOneToOneContract = (input: { nullable: boolean; userIdNullable: boolean }) =>
        createContract<SqlStorage>({
          storage: unboundTables({
            user: table({ id: col('pg/int4', 'pg/int4@1') }),
            profile: table(
              {
                id: col('pg/int4', 'pg/int4@1'),
                user_id: col('pg/int4', 'pg/int4@1', input.userIdNullable),
              },
              { fks: [fk('profile', ['user_id'], 'user', ['id'])] },
            ),
          }),
          models: {
            User: contractModel('user', { id: { column: 'id' } }),
            Profile: contractModel(
              'profile',
              { id: { column: 'id' }, userId: { column: 'user_id' } },
              {
                user: blindCast<ContractRelation, 'test relation literal'>({
                  to: crossRef('User', UNBOUND_NAMESPACE_ID),
                  cardinality: '1:1',
                  nullable: input.nullable,
                  on: { localFields: ['userId'], targetFields: ['id'] },
                }),
              },
            ),
          },
        });

      it.each([true, false])(
        'accepts nullable: %s on a 1:1 side whose foreign key column agrees',
        (nullable) => {
          expect(() =>
            validateSqlContractFully(
              owningOneToOneContract({ nullable, userIdNullable: nullable }),
            ),
          ).not.toThrow();
        },
      );

      it('rejects nullable: true on a 1:1 side whose foreign key column is NOT NULL', () => {
        expect(() =>
          validateSqlContractFully(
            owningOneToOneContract({ nullable: true, userIdNullable: false }),
          ),
        ).toThrow(
          expect.objectContaining({
            phase: 'storage',
            message: expect.stringMatching(
              /Relation "user" on model "__unbound__:Profile" is nullable but every local FK column is NOT NULL.*"user_id"/,
            ),
          }),
        );
      });
    });

    const manyToManyContract = (relationOverrides: {
      on: { localFields: readonly string[]; targetFields: readonly string[] };
      through: {
        table: string;
        namespaceId: string;
        parentColumns: readonly string[];
        childColumns: readonly string[];
        targetColumns: readonly string[];
      };
    }) =>
      createContract<SqlStorage>({
        storage: unboundTables({
          user: table({ id: col('pg/int4', 'pg/int4@1') }),
          tag: table({ id: col('pg/int4', 'pg/int4@1') }),
          user_tags: table({
            user_id: col('pg/int4', 'pg/int4@1'),
            tag_id: col('pg/int4', 'pg/int4@1'),
          }),
        }),
        models: {
          User: contractModel(
            'user',
            { id: { column: 'id' } },
            {
              tags: {
                to: crossRef('Tag', UNBOUND_NAMESPACE_ID),
                cardinality: 'N:M',
                ...relationOverrides,
              },
            },
          ),
          Tag: contractModel('tag', { id: { column: 'id' } }),
        },
      });

    const consistentThrough = {
      table: 'user_tags',
      namespaceId: UNBOUND_NAMESPACE_ID,
      parentColumns: ['user_id'],
      childColumns: ['tag_id'],
      targetColumns: ['id'],
    };

    it('accepts an N:M relation whose through joins existing, type-matched columns', () => {
      const c = manyToManyContract({
        on: { localFields: ['id'], targetFields: ['user_id'] },
        through: consistentThrough,
      });
      expect(() => validateSqlContractFully(c)).not.toThrow();
    });

    it('rejects an N:M relation whose through.parentColumns and on.localFields differ in length', () => {
      const c = manyToManyContract({
        on: { localFields: [], targetFields: ['user_id'] },
        through: consistentThrough,
      });
      expect(() => validateSqlContractFully(c)).toThrow(
        /through\.parentColumns \(1\) with on\.localFields \(0\) of differing length/,
      );
    });

    it('rejects an N:M relation whose through.childColumns and through.targetColumns differ in length', () => {
      const c = manyToManyContract({
        on: { localFields: ['id'], targetFields: ['user_id'] },
        through: { ...consistentThrough, targetColumns: ['id', 'id'] },
      });
      expect(() => validateSqlContractFully(c)).toThrow(
        /through\.childColumns \(1\) with through\.targetColumns \(2\) of differing length/,
      );
    });

    it('rejects an N:M relation whose through references a column absent from the junction table', () => {
      const c = manyToManyContract({
        on: { localFields: ['id'], targetFields: ['user_id'] },
        through: { ...consistentThrough, parentColumns: ['ghost'] },
      });
      expect(() => validateSqlContractFully(c)).toThrow(
        /through\.parentColumns references column "ghost" absent from junction table/,
      );
    });

    it('rejects an N:M relation whose through joins columns of differing storage type', () => {
      const c = createContract<SqlStorage>({
        storage: unboundTables({
          user: table({ id: col('pg/int4', 'pg/int4@1') }),
          tag: table({ id: col('pg/int4', 'pg/int4@1') }),
          user_tags: table({
            user_id: col('pg/text', 'pg/text@1'),
            tag_id: col('pg/int4', 'pg/int4@1'),
          }),
        }),
        models: {
          User: contractModel(
            'user',
            { id: { column: 'id' } },
            {
              tags: {
                to: crossRef('Tag', UNBOUND_NAMESPACE_ID),
                cardinality: 'N:M',
                on: { localFields: ['id'], targetFields: ['user_id'] },
                through: {
                  table: 'user_tags',
                  namespaceId: UNBOUND_NAMESPACE_ID,
                  parentColumns: ['user_id'],
                  childColumns: ['tag_id'],
                  targetColumns: ['id'],
                },
              },
            },
          ),
          Tag: contractModel('tag', { id: { column: 'id' } }),
        },
      });
      expect(() => validateSqlContractFully(c)).toThrow(/differing storage type/);
    });

    const junctionContract = (userId: ReturnType<typeof col>, id: ReturnType<typeof col>) =>
      createContract<SqlStorage>({
        storage: unboundTables({
          user: table({ id }),
          tag: table({ id: col('pg/int4', 'pg/int4@1') }),
          user_tags: table({ user_id: userId, tag_id: col('pg/int4', 'pg/int4@1') }),
        }),
        models: {
          User: contractModel(
            'user',
            { id: { column: 'id' } },
            {
              tags: {
                to: crossRef('Tag', UNBOUND_NAMESPACE_ID),
                cardinality: 'N:M',
                on: { localFields: ['id'], targetFields: ['user_id'] },
                through: {
                  table: 'user_tags',
                  namespaceId: UNBOUND_NAMESPACE_ID,
                  parentColumns: ['user_id'],
                  childColumns: ['tag_id'],
                  targetColumns: ['id'],
                },
              },
            },
          ),
          Tag: contractModel('tag', { id: { column: 'id' } }),
        },
      });

    it('joins junction columns of one data type whatever their codecs', () => {
      const c = junctionContract(col('pg/int8', 'pg/int8number@1'), col('pg/int8', 'pg/int8@1'));
      expect(() => validateSqlContractFully(c)).not.toThrow();
    });

    it('compares junction column parameters without regard to key order', () => {
      const c = junctionContract(
        new StorageColumn({
          dataType: 'pg/numeric',
          codecId: 'pg/numeric@1',
          nullable: false,
          typeParams: { precision: 10, scale: 2 },
        }),
        new StorageColumn({
          dataType: 'pg/numeric',
          codecId: 'pg/numeric@1',
          nullable: false,
          typeParams: { scale: 2, precision: 10 },
        }),
      );
      expect(() => validateSqlContractFully(c)).not.toThrow();
    });

    it('names both data types when junction columns differ', () => {
      const c = junctionContract(col('pg/text', 'pg/text@1'), col('pg/int4', 'pg/int4@1'));
      expect(() => validateSqlContractFully(c)).toThrow(
        /joins "user_tags.user_id" \(pg\/text\) with "user.id" \(pg\/int4\) of differing storage type/,
      );
    });

    it('leaves the storage type of a value-object column to the stack', () => {
      const c = createContract<SqlStorage>({
        storage: unboundTables({
          user: table({ id: col('pg/int4', 'pg/int4@1'), address: col('pg/text', 'pg/text@1') }),
        }),
        models: {
          User: blindCast<ContractModel, 'test model literal with a value-object field'>({
            ...contractModel('user', { id: { column: 'id' }, address: { column: 'address' } }),
            fields: {
              id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
              address: { nullable: false, type: { kind: 'valueObject', name: 'Address' } },
            },
          }),
        },
        valueObjects: {
          Address: {
            fields: { street: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } } },
          },
        },
      });
      expect(() => validateSqlContractFully(c)).not.toThrow();
    });

    it('validates child-side through length even for a cross-space target', () => {
      // The target Tag lives in another contract space, so its storage is not
      // resolvable here — but the childColumns ↔ targetColumns length is still
      // checkable, and here it is wrong.
      const c = createContract<SqlStorage>({
        storage: unboundTables({
          user: table({ id: col('pg/int4', 'pg/int4@1') }),
          user_tags: table({
            user_id: col('pg/int4', 'pg/int4@1'),
            tag_id: col('pg/int4', 'pg/int4@1'),
          }),
        }),
        models: {
          User: contractModel(
            'user',
            { id: { column: 'id' } },
            {
              tags: {
                to: crossRef('Tag', UNBOUND_NAMESPACE_ID, 'other'),
                cardinality: 'N:M',
                on: { localFields: ['id'], targetFields: ['user_id'] },
                through: {
                  table: 'user_tags',
                  namespaceId: UNBOUND_NAMESPACE_ID,
                  parentColumns: ['user_id'],
                  childColumns: ['tag_id'],
                  targetColumns: ['id', 'id'],
                },
              },
            },
          ),
        },
      });
      expect(() => validateSqlContractFully(c)).toThrow(
        /through\.childColumns \(1\) with through\.targetColumns \(2\) of differing length/,
      );
    });

    it('resolves on.localFields field names to storage columns when they differ', () => {
      const c = createContract<SqlStorage>({
        storage: unboundTables({
          account: table({ tenant_id: col('pg/int4', 'pg/int4@1') }),
          tag: table({ id: col('pg/int4', 'pg/int4@1') }),
          account_tags: table({
            acct_tenant: col('pg/int4', 'pg/int4@1'),
            tag_id: col('pg/int4', 'pg/int4@1'),
          }),
        }),
        models: {
          Account: contractModel(
            'account',
            { tenantId: { column: 'tenant_id' } },
            {
              tags: {
                to: crossRef('Tag', UNBOUND_NAMESPACE_ID),
                cardinality: 'N:M',
                on: { localFields: ['tenantId'], targetFields: ['acct_tenant'] },
                through: {
                  table: 'account_tags',
                  namespaceId: UNBOUND_NAMESPACE_ID,
                  parentColumns: ['acct_tenant'],
                  childColumns: ['tag_id'],
                  targetColumns: ['id'],
                },
              },
            },
          ),
          Tag: contractModel('tag', { id: { column: 'id' } }),
        },
      });
      expect(() => validateSqlContractFully(c)).not.toThrow();
    });

    it('throws on missing targetFamily', () => {
      const userTable = table({
        id: col('pg/int4', 'pg/int4@1'),
      });
      const c = createContract<SqlStorage>({
        storage: unboundTables({ user: userTable }),
      });
      const invalid = { ...c, targetFamily: undefined } as unknown;
      expect(() => validateSqlContractFully(invalid)).toThrow(/targetFamily/);
    });

    it('throws ContractValidationError on wrong targetFamily', () => {
      const userTable = table({
        id: col('pg/int4', 'pg/int4@1'),
      });
      const c = createContract<SqlStorage>({
        storage: unboundTables({ user: userTable }),
      });
      const invalid = { ...c, targetFamily: 'document' } as unknown;
      try {
        validateSqlContractFully(invalid);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(ContractValidationError);
        expect((e as ContractValidationError).phase).toBe('structural');
        expect((e as ContractValidationError).message).toMatch(/Unsupported target family/);
      }
    });

    it('throws ContractValidationError on missing target', () => {
      const userTable = table({
        id: col('pg/int4', 'pg/int4@1'),
      });
      const c = createContract<SqlStorage>({
        storage: unboundTables({ user: userTable }),
      });
      const invalid = { ...c, target: undefined } as unknown;
      try {
        validateSqlContractFully(invalid);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(ContractValidationError);
        expect((e as ContractValidationError).phase).toBe('structural');
        expect((e as ContractValidationError).message).toMatch(/target/);
      }
    });

    it('throws on missing storage.storageHash', () => {
      const userTable = table({
        id: col('pg/int4', 'pg/int4@1'),
      });
      const c = createContract<SqlStorage>({
        storage: unboundTables({ user: userTable }),
      });
      const invalid = { ...c, storage: { ...c.storage, storageHash: undefined } } as unknown;
      expect(() => validateSqlContractFully(invalid)).toThrow(/storageHash/);
    });

    it('throws on missing storage', () => {
      const userTable = table({
        id: col('pg/int4', 'pg/int4@1'),
      });
      const c = createContract<SqlStorage>({
        storage: unboundTables({ user: userTable }),
      });
      const invalid = { ...c, storage: undefined } as unknown;
      expect(() => validateSqlContractFully(invalid)).toThrow(/storage/);
    });

    it('throws on missing models', () => {
      const userTable = table({
        id: col('pg/int4', 'pg/int4@1'),
      });
      const c = createContract<SqlStorage>({
        storage: unboundTables({ user: userTable }),
      });
      const invalid = { ...c, models: undefined } as unknown;
      expect(() => validateSqlContractFully(invalid)).toThrow(/models/);
    });

    it('accepts contract with profileHash', () => {
      const userTable = table({
        id: col('pg/int4', 'pg/int4@1'),
      });
      const c = createContract<SqlStorage>({
        storage: unboundTables({ user: userTable }),
      });
      expect(() => validateSqlContractFully(c)).not.toThrow();
    });

    it('rejects contract without profileHash', () => {
      const userTable = table({
        id: col('pg/int4', 'pg/int4@1'),
      });
      const c = createContract<SqlStorage>({
        storage: unboundTables({ user: userTable }),
      });
      const { profileHash: _, ...withoutProfileHash } = c;
      expect(() => validateSqlContractFully(withoutProfileHash)).toThrow(/profileHash/);
    });

    it('accepts optional capabilities', () => {
      const userTable = table({
        id: col('pg/int4', 'pg/int4@1'),
      });
      const c = createContract<SqlStorage>({
        storage: unboundTables({ user: userTable }),
        capabilities: {
          postgres: {
            returning: true,
          },
        },
      });
      expect(() => validateSqlContractFully(c)).not.toThrow();
    });

    it('accepts optional extension packs', () => {
      const userTable = table({
        id: col('pg/int4', 'pg/int4@1'),
      });
      const c = createContract<SqlStorage>({
        storage: unboundTables({ user: userTable }),
        extensions: {
          postgres: {
            id: 'postgres',
            version: '0.0.1',
          },
        },
      });
      expect(() => validateSqlContractFully(c)).not.toThrow();
    });

    it('accepts optional meta', () => {
      const userTable = table({
        id: col('pg/int4', 'pg/int4@1'),
      });
      const c = createContract<SqlStorage>({
        storage: unboundTables({ user: userTable }),
        meta: {
          generated: true,
        },
      });
      expect(() => validateSqlContractFully(c)).not.toThrow();
    });

    it('rejects unknown top-level keys', () => {
      const userTable = table({ id: col('pg/int4', 'pg/int4@1') });
      const base = createContract<SqlStorage>({
        storage: unboundTables({ user: userTable }),
      });
      const c = {
        ...base,
        mappings: { modelToTable: { User: 'user' } },
      };
      expect(() => validateSqlContractFully(c)).toThrow('mappings must be removed');
    });

    it('validates FK with source and target coordinates only', () => {
      const userTable = table({ id: col('pg/int4', 'pg/int4@1') }, { pk: pk('id') });
      const postTable = table(
        { id: col('pg/int4', 'pg/int4@1'), userId: col('pg/int4', 'pg/int4@1') },
        {
          pk: pk('id'),
          fks: [fk('post', ['userId'], 'user', ['id'])],
        },
      );
      const c = createContract<SqlStorage>({
        storage: unboundTables({ user: userTable, post: postTable }),
      });
      expect(() => validateSqlContractFully(c)).not.toThrow();
    });

    it('validates storage with FK referential actions', () => {
      const actions: ReferentialAction[] = [
        'noAction',
        'restrict',
        'cascade',
        'setNull',
        'setDefault',
      ];
      for (const action of actions) {
        const postTable = table(
          {
            id: col('pg/int4', 'pg/int4@1'),
            userId: col('pg/int4', 'pg/int4@1'),
          },
          { fks: [fk('post', ['userId'], 'user', ['id'], { onDelete: action })] },
        );
        const s = createContract<SqlStorage>({
          storage: unboundTables({ post: postTable }),
        }).storage;
        expect(() => validateStorage(s)).not.toThrow();
      }
    });

    it('validates storage with FK onDelete and onUpdate', () => {
      const postTable = table(
        {
          id: col('pg/int4', 'pg/int4@1'),
          userId: col('pg/int4', 'pg/int4@1'),
        },
        {
          fks: [
            fk('post', ['userId'], 'user', ['id'], { onDelete: 'cascade', onUpdate: 'noAction' }),
          ],
        },
      );
      const s = createContract<SqlStorage>({
        storage: unboundTables({ post: postTable }),
      }).storage;
      expect(() => validateStorage(s)).not.toThrow();
    });

    it('throws on invalid referential action string', () => {
      const invalid = {
        storageHash: 'test',
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            entries: {
              table: {
                post: {
                  columns: {
                    id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
                    userId: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
                  },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [
                    {
                      source: {
                        namespaceId: UNBOUND_NAMESPACE_ID,
                        tableName: 'post',
                        columns: ['userId'],
                      },
                      target: {
                        namespaceId: UNBOUND_NAMESPACE_ID,
                        tableName: 'user',
                        columns: ['id'],
                      },
                      onDelete: 'invalidAction',
                    },
                  ],
                },
              },
            },
          },
        },
      } as unknown;
      expect(() => validateStorage(invalid)).toThrow();
    });

    it('rejects FK whose source coordinates do not match the owning table', () => {
      const rawContract = createContract({
        storage: unboundTables({
          user: {
            columns: { id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false } },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
          post: {
            columns: {
              id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
              userId: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [
              {
                source: {
                  namespaceId: UNBOUND_NAMESPACE_ID,
                  tableName: 'wrongTable',
                  columns: ['userId'],
                },
                target: { namespaceId: UNBOUND_NAMESPACE_ID, tableName: 'user', columns: ['id'] },
              },
            ],
          },
        }),
      });
      expect(() => validateSqlContractFully(rawContract)).toThrow(/mismatched source coordinates/);
    });

    it('resolves cross-namespace FK targets by namespaceId, not by bare table name', () => {
      const rawContract = createContract({
        storage: {
          namespaces: {
            auth: {
              id: 'auth',
              entries: {
                table: {
                  users: {
                    columns: {
                      id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
                    },
                    primaryKey: { columns: ['id'] },
                    uniques: [],
                    indexes: [],
                    foreignKeys: [],
                  },
                },
              },
            },
            analytics: {
              id: 'analytics',
              entries: {
                table: {
                  users: {
                    columns: {
                      user_uuid: { dataType: 'pg/uuid', codecId: 'pg/uuid@1', nullable: false },
                    },
                    primaryKey: { columns: ['user_uuid'] },
                    uniques: [],
                    indexes: [],
                    foreignKeys: [],
                  },
                  events: {
                    columns: {
                      id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
                      user_uuid: { dataType: 'pg/uuid', codecId: 'pg/uuid@1', nullable: false },
                    },
                    primaryKey: { columns: ['id'] },
                    uniques: [],
                    indexes: [],
                    foreignKeys: [
                      {
                        source: {
                          namespaceId: 'analytics',
                          tableName: 'events',
                          columns: ['user_uuid'],
                        },
                        target: {
                          namespaceId: 'analytics',
                          tableName: 'users',
                          columns: ['user_uuid'],
                        },
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      });
      expect(() => validateSqlContractFully(rawContract)).not.toThrow();
    });

    it('rejects an FK whose target namespaceId points at a different namespace whose same-named table lacks the referenced column', () => {
      // Same fixture as above but the FK target.namespaceId is "auth" instead
      // of "analytics". Pre-fix this validated against the workspace-wide
      // table-name set and silently accepted, because "users" existed in
      // analytics. With namespace-qualified resolution it correctly resolves
      // to auth.users — which has only column "id", not "user_uuid".
      const rawContract = createContract({
        storage: {
          namespaces: {
            auth: {
              id: 'auth',
              entries: {
                table: {
                  users: {
                    columns: {
                      id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
                    },
                    primaryKey: { columns: ['id'] },
                    uniques: [],
                    indexes: [],
                    foreignKeys: [],
                  },
                },
              },
            },
            analytics: {
              id: 'analytics',
              entries: {
                table: {
                  users: {
                    columns: {
                      user_uuid: { dataType: 'pg/uuid', codecId: 'pg/uuid@1', nullable: false },
                    },
                    primaryKey: { columns: ['user_uuid'] },
                    uniques: [],
                    indexes: [],
                    foreignKeys: [],
                  },
                  events: {
                    columns: {
                      id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
                      user_uuid: { dataType: 'pg/uuid', codecId: 'pg/uuid@1', nullable: false },
                    },
                    primaryKey: { columns: ['id'] },
                    uniques: [],
                    indexes: [],
                    foreignKeys: [
                      {
                        source: {
                          namespaceId: 'analytics',
                          tableName: 'events',
                          columns: ['user_uuid'],
                        },
                        target: {
                          namespaceId: 'auth',
                          tableName: 'users',
                          columns: ['user_uuid'],
                        },
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      });
      expect(() => validateSqlContractFully(rawContract)).toThrow(
        /non-existent column "user_uuid" in table "users"/,
      );
    });
  });

  describe('validateStorageSemantics', () => {
    it('rejects setNull on non-nullable FK column', () => {
      const s = createContract<SqlStorage>({
        storage: unboundTables({
          user: table({ id: col('pg/int4', 'pg/int4@1') }),
          post: table(
            {
              id: col('pg/int4', 'pg/int4@1'),
              userId: col('pg/int4', 'pg/int4@1', false),
            },
            { fks: [fk('post', ['userId'], 'user', ['id'], { onDelete: 'setNull' })] },
          ),
        }),
      }).storage;
      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('setNull');
      expect(errors[0]).toContain('userId');
    });

    it('allows setNull on nullable FK column', () => {
      const s = createContract<SqlStorage>({
        storage: unboundTables({
          user: table({ id: col('pg/int4', 'pg/int4@1') }),
          post: table(
            {
              id: col('pg/int4', 'pg/int4@1'),
              userId: col('pg/int4', 'pg/int4@1', true),
            },
            { fks: [fk('post', ['userId'], 'user', ['id'], { onDelete: 'setNull' })] },
          ),
        }),
      }).storage;
      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(0);
    });

    it('allows cascade on non-nullable FK column', () => {
      const s = createContract<SqlStorage>({
        storage: unboundTables({
          user: table({ id: col('pg/int4', 'pg/int4@1') }),
          post: table(
            {
              id: col('pg/int4', 'pg/int4@1'),
              userId: col('pg/int4', 'pg/int4@1', false),
            },
            { fks: [fk('post', ['userId'], 'user', ['id'], { onDelete: 'cascade' })] },
          ),
        }),
      }).storage;
      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(0);
    });

    it('rejects setNull on onUpdate for non-nullable FK column', () => {
      const s = createContract<SqlStorage>({
        storage: unboundTables({
          user: table({ id: col('pg/int4', 'pg/int4@1') }),
          post: table(
            {
              id: col('pg/int4', 'pg/int4@1'),
              userId: col('pg/int4', 'pg/int4@1', false),
            },
            { fks: [fk('post', ['userId'], 'user', ['id'], { onUpdate: 'setNull' })] },
          ),
        }),
      }).storage;
      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('setNull');
    });

    it('rejects setDefault on non-nullable FK column without DEFAULT', () => {
      const s = createContract<SqlStorage>({
        storage: unboundTables({
          user: table({ id: col('pg/int4', 'pg/int4@1') }),
          post: table(
            {
              id: col('pg/int4', 'pg/int4@1'),
              userId: col('pg/int4', 'pg/int4@1', false),
            },
            { fks: [fk('post', ['userId'], 'user', ['id'], { onDelete: 'setDefault' })] },
          ),
        }),
      }).storage;
      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('setDefault');
      expect(errors[0]).toContain('userId');
      expect(errors[0]).toContain('NOT NULL');
      expect(errors[0]).toContain('no DEFAULT');
    });

    it('allows setDefault on non-nullable FK column with DEFAULT', () => {
      const s = createContract<SqlStorage>({
        storage: unboundTables({
          user: table({ id: col('pg/int4', 'pg/int4@1') }),
          post: table(
            {
              id: col('pg/int4', 'pg/int4@1'),
              userId: {
                dataType: 'pg/int4',
                codecId: 'pg/int4@1',
                nullable: false,
                default: { kind: 'literal', value: 0 },
              },
            },
            { fks: [fk('post', ['userId'], 'user', ['id'], { onDelete: 'setDefault' })] },
          ),
        }),
      }).storage;
      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(0);
    });

    it('allows setDefault on nullable FK column without DEFAULT', () => {
      const s = createContract<SqlStorage>({
        storage: unboundTables({
          user: table({ id: col('pg/int4', 'pg/int4@1') }),
          post: table(
            {
              id: col('pg/int4', 'pg/int4@1'),
              userId: col('pg/int4', 'pg/int4@1', true),
            },
            { fks: [fk('post', ['userId'], 'user', ['id'], { onDelete: 'setDefault' })] },
          ),
        }),
      }).storage;
      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(0);
    });

    it('rejects setDefault on onUpdate for non-nullable FK column without DEFAULT', () => {
      const s = createContract<SqlStorage>({
        storage: unboundTables({
          user: table({ id: col('pg/int4', 'pg/int4@1') }),
          post: table(
            {
              id: col('pg/int4', 'pg/int4@1'),
              userId: col('pg/int4', 'pg/int4@1', false),
            },
            { fks: [fk('post', ['userId'], 'user', ['id'], { onUpdate: 'setDefault' })] },
          ),
        }),
      }).storage;
      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('setDefault');
    });

    it('rejects duplicate named objects within the same table', () => {
      const s = createContract<SqlStorage>({
        storage: unboundTables({
          user: table(
            {
              id: col('pg/int4', 'pg/int4@1'),
              email: col('pg/text', 'pg/text@1'),
            },
            {
              pk: { columns: ['id'], name: 'user_pkey' },
              indexes: [serializedIndex({ columns: ['id'], name: 'user_pkey', unique: false })],
            },
          ),
        }),
      }).storage;

      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('user_pkey');
      expect(errors[0]).toContain('primary key');
      expect(errors[0]).toContain('index');
    });

    it('rejects duplicate uniques, and two index entries sharing one name', () => {
      const s = createContract<SqlStorage>({
        storage: unboundTables({
          user: table(
            {
              id: col('pg/int4', 'pg/int4@1'),
              email: col('pg/text', 'pg/text@1'),
            },
            {
              uniques: [unique('email'), unique('email')],
              indexes: [index('user_email_idx', ['email']), index('user_email_idx', ['email'])],
            },
          ),
        }),
      }).storage;

      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(2);
      expect(errors[0]).toContain('"user_email_idx" is declared multiple times (index, index)');
      expect(errors[1]).toContain('duplicate unique constraint definition');
    });

    it('two content-identical EXACT indexes under different names validate (legal twins)', () => {
      const s = createContract<SqlStorage>({
        storage: unboundTables({
          user: table(
            {
              id: col('pg/int4', 'pg/int4@1'),
              email: col('pg/text', 'pg/text@1'),
            },
            {
              indexes: [index('user_email_idx1', ['email']), index('user_email_idx2', ['email'])],
            },
          ),
        }),
      }).storage;

      expect(validateStorageSemantics(s)).toEqual([]);
    });

    it('two content-identical WIRE-NAMED indexes under different prefixes still reject', () => {
      const s = createContract<SqlStorage>({
        storage: unboundTables({
          user: table(
            {
              id: col('pg/int4', 'pg/int4@1'),
              email: col('pg/text', 'pg/text@1'),
            },
            {
              indexes: [
                index('a_idx_46df9cad', ['email'], { prefix: 'a_idx' }),
                index('b_idx_46df9cad', ['email'], { prefix: 'b_idx' }),
              ],
            },
          ),
        }),
      }).storage;

      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('duplicate index definition');
    });

    it('rejects duplicate columns inside key, unique, and index definitions', () => {
      const s = createContract<SqlStorage>({
        storage: unboundTables({
          user: table(
            {
              id: col('pg/int4', 'pg/int4@1'),
              email: col('pg/text', 'pg/text@1'),
            },
            {
              pk: pk('id', 'id'),
              uniques: [unique('email', 'email')],
              indexes: [index('user_email_idx', ['email', 'email'])],
            },
          ),
        }),
      }).storage;

      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(3);
      expect(errors[0]).toContain('primary key');
      expect(errors[0]).toContain('duplicate column "id"');
      expect(errors[1]).toContain('unique constraint');
      expect(errors[1]).toContain('duplicate column "email"');
      expect(errors[2]).toContain('index');
      expect(errors[2]).toContain('duplicate column "email"');
    });

    it('rejects nullable primary-key columns', () => {
      const s = createContract<SqlStorage>({
        storage: unboundTables({
          user: table(
            {
              id: col('pg/int4', 'pg/int4@1', true),
            },
            {
              pk: pk('id'),
            },
          ),
        }),
      }).storage;

      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('primary key column "id"');
      expect(errors[0]).toContain('NOT NULL');
    });

    it('detects duplicate wire-named index definitions whose options differ only in key order', () => {
      const s = createContract<SqlStorage>({
        storage: unboundTables({
          user: table(
            {
              id: col('pg/int4', 'pg/int4@1'),
              email: col('pg/text', 'pg/text@1'),
            },
            {
              indexes: [
                serializedIndex({
                  name: 'gin1_0695c6f4',
                  prefix: 'gin1',
                  columns: ['email'],
                  unique: false,
                  type: 'gin',
                  options: { a: '1', b: '2' },
                }),
                serializedIndex({
                  name: 'gin2_0695c6f4',
                  prefix: 'gin2',
                  columns: ['email'],
                  unique: false,
                  type: 'gin',
                  options: { b: '2', a: '1' },
                }),
              ],
            },
          ),
        }),
      }).storage;

      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('duplicate index definition');
    });

    it('a unique index and a plain index on the same column tuple are not duplicates (twins)', () => {
      const s = createContract<SqlStorage>({
        storage: unboundTables({
          user: table(
            {
              id: col('pg/int4', 'pg/int4@1'),
              email: col('pg/text', 'pg/text@1'),
            },
            {
              indexes: [
                serializedIndex({
                  name: 'user_email_unique_idx',
                  columns: ['email'],
                  unique: true,
                }),
                serializedIndex({
                  name: 'user_email_plain_idx',
                  columns: ['email'],
                  unique: false,
                }),
              ],
            },
          ),
        }),
      }).storage;

      expect(validateStorageSemantics(s)).toHaveLength(0);
    });

    it('two expression indexes with different bodies are not duplicates', () => {
      const s = createContract<SqlStorage>({
        storage: unboundTables({
          user: table(
            {
              id: col('pg/int4', 'pg/int4@1'),
              email: col('pg/text', 'pg/text@1'),
            },
            {
              indexes: [
                serializedIndex({
                  name: 'user_email_lower',
                  expression: 'lower(email)',
                  unique: false,
                }),
                serializedIndex({
                  name: 'user_email_upper',
                  expression: 'upper(email)',
                  unique: false,
                }),
              ],
            },
          ),
        }),
      }).storage;

      expect(validateStorageSemantics(s)).toHaveLength(0);
    });

    it('two same-column indexes with different where predicates are not duplicates', () => {
      const s = createContract<SqlStorage>({
        storage: unboundTables({
          user: table(
            {
              id: col('pg/int4', 'pg/int4@1'),
              email: col('pg/text', 'pg/text@1'),
            },
            {
              indexes: [
                serializedIndex({
                  name: 'user_email_active',
                  columns: ['email'],
                  where: 'deleted_at IS NULL',
                  unique: false,
                }),
                serializedIndex({ name: 'user_email_all', columns: ['email'], unique: false }),
              ],
            },
          ),
        }),
      }).storage;

      expect(validateStorageSemantics(s)).toHaveLength(0);
    });

    it('detects duplicate WIRE-NAMED expression index definitions with identical bodies', () => {
      const s = createContract<SqlStorage>({
        storage: unboundTables({
          user: table(
            {
              id: col('pg/int4', 'pg/int4@1'),
              email: col('pg/text', 'pg/text@1'),
            },
            {
              indexes: [
                serializedIndex({
                  name: 'lower1_17273133',
                  prefix: 'lower1',
                  expression: 'lower(email)',
                  unique: false,
                }),
                serializedIndex({
                  name: 'lower2_17273133',
                  prefix: 'lower2',
                  expression: 'lower(email)',
                  unique: false,
                }),
              ],
            },
          ),
        }),
      }).storage;

      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('duplicate index definition');
    });

    it('two content-identical EXACT expression indexes under different names validate (twins)', () => {
      const s = createContract<SqlStorage>({
        storage: unboundTables({
          user: table(
            {
              id: col('pg/int4', 'pg/int4@1'),
              email: col('pg/text', 'pg/text@1'),
            },
            {
              indexes: [
                serializedIndex({
                  name: 'user_email_lower1',
                  expression: 'lower(email)',
                  unique: false,
                }),
                serializedIndex({
                  name: 'user_email_lower2',
                  expression: 'lower(email)',
                  unique: false,
                }),
              ],
            },
          ),
        }),
      }).storage;

      expect(validateStorageSemantics(s)).toEqual([]);
    });

    it('rejects duplicate foreign key definitions within the same table', () => {
      const s = createContract<SqlStorage>({
        storage: unboundTables({
          user: table(
            {
              id: col('pg/int4', 'pg/int4@1'),
              orgId: col('pg/int4', 'pg/int4@1'),
            },
            {
              fks: [
                fk('user', ['orgId'], 'org', ['id'], { onDelete: 'cascade' }),
                fk('user', ['orgId'], 'org', ['id'], { onDelete: 'cascade' }),
              ],
            },
          ),
          org: table({
            id: col('pg/int4', 'pg/int4@1'),
          }),
        }),
      }).storage;

      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('duplicate foreign key definition');
    });

    it('returns no errors for storage without FKs', () => {
      const s = createContract<SqlStorage>({
        storage: unboundTables({
          user: table({ id: col('pg/int4', 'pg/int4@1') }),
        }),
      }).storage;
      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(0);
    });

    it('returns no errors for a table with a valid check constraint', () => {
      const s = createContract<SqlStorage>({
        storage: unboundTables({
          user: new StorageTable({
            columns: { role: { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false } },
            uniques: [],
            indexes: [],
            foreignKeys: [],
            checks: [checkConstraint('user_role_check', roleInCheck)],
          }),
        }),
      }).storage;
      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(0);
    });

    it('rejects a check constraint whose name collides with another named object', () => {
      const s = createContract<SqlStorage>({
        storage: unboundTables({
          user: new StorageTable({
            columns: {
              id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
              role: { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false },
            },
            uniques: [],
            indexes: [serializedIndex({ columns: ['id'], name: 'shared_name', unique: false })],
            foreignKeys: [],
            checks: [checkConstraint('shared_name', roleInCheck)],
          }),
        }),
      }).storage;
      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('shared_name');
      expect(errors[0]).toContain('check constraint');
      expect(errors[0]).toContain('index');
    });

    it('accepts two exact-named checks sharing one expression (the legacy adoption shape)', () => {
      const s = createContract<SqlStorage>({
        storage: unboundTables({
          user: new StorageTable({
            columns: { role: { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false } },
            uniques: [],
            indexes: [],
            foreignKeys: [],
            checks: [
              checkConstraint('user_role_check_a', roleInCheck),
              checkConstraint('user_role_check_b', roleInCheck),
            ],
          }),
        }),
      }).storage;
      expect(validateStorageSemantics(s)).toEqual([]);
    });

    it('rejects two wire-named checks whose expressions differ only in whitespace', () => {
      const spacedOut = roleInCheck.replace(' IN ', '  IN  ');
      const s = createContract<SqlStorage>({
        storage: unboundTables({
          user: new StorageTable({
            columns: { role: { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false } },
            uniques: [],
            indexes: [],
            foreignKeys: [],
            checks: [
              wireCheckConstraint('user_role_check', roleInCheck),
              wireCheckConstraint('user_role_alt_check', spacedOut),
            ],
          }),
        }),
      }).storage;
      const errors = validateStorageSemantics(s);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('duplicate check constraint definition');
    });
  });

  describe('validateSqlStorageConsistency', () => {
    it('throws when an index references a non-existent column', () => {
      const rawContract = createContract({
        storage: unboundTables({
          user: new StorageTable({
            columns: { role: { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false } },
            uniques: [],
            indexes: [
              serializedIndex({ columns: ['status'], name: 'user_status_idx', unique: false }),
            ],
            foreignKeys: [],
          }),
        }),
      });
      expect(() => validateSqlStorageConsistency(rawContract as never)).toThrow(
        /index references non-existent column "status"/,
      );
    });

    it('does not throw when every index column exists', () => {
      const rawContract = createContract({
        storage: unboundTables({
          user: new StorageTable({
            columns: { role: { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false } },
            uniques: [],
            indexes: [serializedIndex({ columns: ['role'], name: 'user_role_idx', unique: false })],
            foreignKeys: [],
          }),
        }),
      });
      expect(() => validateSqlStorageConsistency(rawContract as never)).not.toThrow();
    });
  });

  describe('validateSqlContractFully strict mode', () => {
    it('rejects unknown top-level properties', () => {
      const c = createContract<SqlStorage>({
        storage: unboundTables({ users: table({ id: col('pg/int4', 'pg/int4@1') }) }),
        models: { User: contractModel('users', { id: { column: 'id' } }) },
      });
      const withUnknown = { ...c, bogusField: 'unexpected' };
      expect(() => validateSqlContractFully(withUnknown)).toThrow();
    });

    it('accepts valid contracts without unknown properties', () => {
      const c = createContract<SqlStorage>({
        storage: unboundTables({ users: table({ id: col('pg/int4', 'pg/int4@1') }) }),
        models: { User: contractModel('users', { id: { column: 'id' } }) },
      });
      expect(() => validateSqlContractFully(c)).not.toThrow();
    });
  });

  describe('ValueSetRef call-site-narrowed schemas', () => {
    const storageSchema = createSqlStorageSchema(composeSqlEntityKinds());

    function makeStorageWithColumnRef(ref: Record<string, unknown>) {
      return {
        storageHash: 'test',
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            entries: {
              table: {
                users: {
                  columns: {
                    role: {
                      dataType: 'pg/text',
                      codecId: 'pg/text@1',
                      nullable: false,
                      valueSet: ref,
                    },
                  },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
              },
            },
          },
        },
      };
    }

    it('accepts a storage column value-set ref with plane:storage + entityKind:valueSet', () => {
      const result = storageSchema(
        makeStorageWithColumnRef({
          plane: 'storage',
          entityKind: 'valueSet',
          namespaceId: 'public',
          entityName: 'Role',
        }),
      );
      expect(result).not.toBeInstanceOf(type.errors);
    });

    it('rejects a storage column value-set ref with plane:domain + entityKind:enum', () => {
      const result = storageSchema(
        makeStorageWithColumnRef({
          plane: 'domain',
          entityKind: 'enum',
          namespaceId: 'public',
          entityName: 'Role',
        }),
      );
      expect(result).toBeInstanceOf(type.errors);
    });

    it('rejects a storage column value-set ref with plane:domain + entityKind:valueSet', () => {
      const result = storageSchema(
        makeStorageWithColumnRef({
          plane: 'domain',
          entityKind: 'valueSet',
          namespaceId: 'public',
          entityName: 'Role',
        }),
      );
      expect(result).toBeInstanceOf(type.errors);
    });

    it('accepts a domain field ref with plane:domain + entityKind:enum', () => {
      const result = validateModel({
        fields: {
          role: {
            nullable: false,
            many: false,
            type: { kind: 'scalar', codecId: 'pg/text@1' },
            valueSet: {
              plane: 'domain',
              entityKind: 'enum',
              namespaceId: 'public',
              entityName: 'Role',
            },
          },
        },
        relations: {},
        storage: { table: 'user', namespaceId: 'public', fields: { role: { column: 'role' } } },
      });
      expect(result).toBeDefined();
    });

    it('rejects a domain field ref with plane:storage + entityKind:valueSet', () => {
      expect(() =>
        validateModel({
          fields: {
            role: {
              nullable: false,
              type: { kind: 'scalar', codecId: 'pg/text@1' },
              valueSet: {
                plane: 'storage',
                entityKind: 'valueSet',
                namespaceId: 'public',
                entityName: 'Role',
              },
            },
          },
          relations: {},
          storage: { table: 'user', namespaceId: 'public', fields: { role: { column: 'role' } } },
        }),
      ).toThrow();
    });

    it('StorageValueSetSchema accepts kind valueSet', () => {
      const result = StorageValueSetSchema({ kind: 'valueSet', values: ['a', 'b'] });
      expect(result).not.toBeInstanceOf(type.errors);
    });

    it('StorageValueSetSchema rejects kind value-set', () => {
      const result = StorageValueSetSchema({ kind: 'value-set', values: ['a', 'b'] });
      expect(result).toBeInstanceOf(type.errors);
    });
  });

  describe('composeSqlEntityKinds', () => {
    it('accepts a non-colliding pack kind', () => {
      const packDescriptor = {
        kind: ' table',
        schema: type('unknown'),
        construct: (v: unknown) => v,
      };
      expect(() => composeSqlEntityKinds([packDescriptor])).not.toThrow();
    });

    it('throws on a duplicate entity kind (table)', () => {
      const collidingDescriptor = {
        kind: 'table',
        schema: type('unknown'),
        construct: (v: unknown) => v,
      };
      expect(() => composeSqlEntityKinds([collidingDescriptor])).toThrow(/duplicate entity kind/);
    });

    it('throws on a duplicate entity kind (valueSet)', () => {
      const collidingDescriptor = {
        kind: 'valueSet',
        schema: type('unknown'),
        construct: (v: unknown) => v,
      };
      expect(() => composeSqlEntityKinds([collidingDescriptor])).toThrow(/duplicate entity kind/);
    });

    it('registers non-colliding pack kinds', () => {
      const packDescriptor = {
        kind: 'type',
        schema: type('unknown'),
        construct: (v: unknown) => v,
      };
      const kinds = composeSqlEntityKinds([packDescriptor]);
      expect(kinds.has('type')).toBe(true);
      expect(kinds.has('table')).toBe(true);
      expect(kinds.has('valueSet')).toBe(true);
    });
  });
});

describe('validateSqlContractFully — pre-name-identity index shape', () => {
  // Pinned because the 0.16-to-0.17 upgrade instructions quote these
  // substrings: a consumer loading a 0.16-emitted contract must be able to
  // grep the documented text out of the real error.
  it('rejects a 0.16-shaped index entry naming the missing name and unique fields', () => {
    const contract: unknown = {
      target: 'postgres',
      targetFamily: 'sql',
      profileHash: 'e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0',
      storage: {
        storageHash: 'e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0e0',
        namespaces: {
          public: {
            id: 'public',
            kind: 'postgres-schema',
            entries: {
              table: {
                user: {
                  columns: {
                    id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
                    email: { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false },
                  },
                  primaryKey: { columns: ['id'] },
                  uniques: [],
                  indexes: [{ columns: ['email'] }],
                  foreignKeys: [],
                },
              },
            },
          },
        },
      },
      domain: { namespaces: { __unbound__: { models: {} } } },
      roots: {},
      capabilities: {},
      extensions: {},
      meta: {},
    };

    const validate = () =>
      validateSqlContractFully(contract as Parameters<typeof validateSqlContractFully>[0]);
    expect(validate).toThrow('Contract structural validation failed');
    expect(validate).toThrow('indexes[0].name must be a string (was missing)');
    expect(validate).toThrow('indexes[0].unique must be boolean (was missing)');
  });
});
