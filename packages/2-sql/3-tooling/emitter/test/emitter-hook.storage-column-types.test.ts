import { generateContractDts } from '@internal/emitter';
import { type CodecLookup, renderTsLiteral } from '@internal/framework-components/codec';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { sqlEmission } from '../src/index';
import { createEmitterTestContract as createContract } from './create-emitter-test-contract';
import {
  identityCodecLookup,
  NON_IDENTITY_CODEC_ID,
  nonIdentityCodecLookup,
} from './value-set-codec-lookups';

const testHashes = { storageHash: 'test-core-hash', profileHash: 'test-profile-hash' };

function vectorCodecLookup(): CodecLookup {
  return {
    get: () => undefined,
    targetTypesFor: () => undefined,
    renderOutputTypeFor: (id, params) =>
      id === 'pg/vector@1' ? `Vector<${params['length']}>` : undefined,
    renderInputTypeFor: (id, params) =>
      id === 'pg/vector@1' ? `VectorInput<${params['length']}>` : undefined,
    renderValueLiteralFor: (_id, value) => renderTsLiteral(value),
  };
}

describe('StorageColumnTypes', () => {
  it('emits a literal union entry for an enum column (text codec)', () => {
    const contract = createContract({
      domain: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            models: {
              Post: {
                storage: {
                  namespaceId: UNBOUND_NAMESPACE_ID,
                  table: 'post',
                  fields: { priority: { column: 'priority' } },
                },
                fields: {
                  priority: {
                    nullable: false,
                    type: { kind: 'scalar', codecId: 'pg/text@1' },
                    valueSet: {
                      plane: 'domain',
                      entityKind: 'enum',
                      namespaceId: UNBOUND_NAMESPACE_ID,
                      entityName: 'Priority',
                    },
                  },
                },
                relations: {},
              },
            },
            enum: {
              Priority: {
                codecId: 'pg/text@1',
                members: [
                  { name: 'Low', value: 'low' },
                  { name: 'High', value: 'high' },
                  { name: 'Urgent', value: 'urgent' },
                ],
              },
            },
          },
        },
      },
      storage: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            entries: {
              table: {
                post: {
                  columns: {
                    priority: {
                      nativeType: 'text',
                      codecId: 'pg/text@1',
                      nullable: false,
                      valueSet: {
                        plane: 'storage',
                        entityKind: 'valueSet',
                        namespaceId: UNBOUND_NAMESPACE_ID,
                        entityName: 'Priority',
                      },
                    },
                  },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
              },
              valueSet: {
                Priority: { kind: 'valueSet', values: ['low', 'high', 'urgent'] },
              },
            },
          },
        },
      },
    });

    const dts = generateContractDts(
      contract,
      sqlEmission,
      [],
      testHashes,
      undefined,
      identityCodecLookup,
    );

    expect(dts).toContain('export type StorageColumnTypes =');
    // The column entry must be a plain literal union — no ContractBase[...] expression.
    expect(dts).toContain('readonly priority: "low" | "high" | "urgent"');
    expect(dts).not.toContain('ContractBase[');
    expect(dts).not.toContain('["members"][number]');
  });

  it('emits a codec output entry for a non-enum column', () => {
    const contract = createContract({
      domain: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            models: {
              User: {
                storage: {
                  namespaceId: UNBOUND_NAMESPACE_ID,
                  table: 'user',
                  fields: { email: { column: 'email' } },
                },
                fields: {
                  email: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
                },
                relations: {},
              },
            },
          },
        },
      },
      storage: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            entries: {
              table: {
                user: {
                  columns: {
                    email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
                  },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
              },
            },
          },
        },
      },
    });

    const dts = generateContractDts(contract, sqlEmission, [], testHashes);

    expect(dts).toContain('export type StorageColumnTypes =');
    // Non-enum column: codec output access.
    expect(dts).toContain('readonly email: CodecTypes["pg/text@1"]["output"]');
  });

  it('emits a literal union for a numeric-codec (int) enum column', () => {
    const contract = createContract({
      domain: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            models: {
              Item: {
                storage: {
                  namespaceId: UNBOUND_NAMESPACE_ID,
                  table: 'item',
                  fields: { level: { column: 'level' } },
                },
                fields: {
                  level: {
                    nullable: false,
                    type: { kind: 'scalar', codecId: 'pg/int4@1' },
                    valueSet: {
                      plane: 'domain',
                      entityKind: 'enum',
                      namespaceId: UNBOUND_NAMESPACE_ID,
                      entityName: 'Level',
                    },
                  },
                },
                relations: {},
              },
            },
            enum: {
              Level: {
                codecId: 'pg/int4@1',
                members: [
                  { name: 'Beginner', value: 1 },
                  { name: 'Advanced', value: 2 },
                ],
              },
            },
          },
        },
      },
      storage: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            entries: {
              table: {
                item: {
                  columns: {
                    level: {
                      nativeType: 'int4',
                      codecId: 'pg/int4@1',
                      nullable: false,
                      valueSet: {
                        plane: 'storage',
                        entityKind: 'valueSet',
                        namespaceId: UNBOUND_NAMESPACE_ID,
                        entityName: 'Level',
                      },
                    },
                  },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
              },
              valueSet: {
                Level: { kind: 'valueSet', values: [1, 2] },
              },
            },
          },
        },
      },
    });

    const dts = generateContractDts(
      contract,
      sqlEmission,
      [],
      testHashes,
      undefined,
      identityCodecLookup,
    );

    expect(dts).toContain('readonly level: 1 | 2');
    // Must be plain literals, not a codec reference or ContractBase expression.
    expect(dts).not.toContain('ContractBase[');
  });

  it('emits the __unbound__ namespace in StorageColumnTypes', () => {
    const contract = createContract({
      domain: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            models: {
              Tag: {
                storage: {
                  namespaceId: UNBOUND_NAMESPACE_ID,
                  table: 'tag',
                  fields: { name: { column: 'name' } },
                },
                fields: {
                  name: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
                },
                relations: {},
              },
            },
          },
        },
      },
      storage: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            entries: {
              table: {
                tag: {
                  columns: {
                    name: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
                  },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
              },
            },
          },
        },
      },
    });

    const dts = generateContractDts(contract, sqlEmission, [], testHashes);

    expect(dts).toContain('export type StorageColumnTypes =');
    // __unbound__ is a valid identifier so serializeObjectKey does not quote it.
    expect(dts).toContain(`readonly ${UNBOUND_NAMESPACE_ID}:`);
  });

  it('includes a value-set column with no domain field in StorageColumnTypes (raw value-set case)', () => {
    const contract = createContract({
      domain: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            models: {
              Audit: {
                storage: {
                  namespaceId: UNBOUND_NAMESPACE_ID,
                  table: 'audit',
                  fields: { id: { column: 'id' } },
                },
                fields: {
                  id: { nullable: false, type: { kind: 'scalar', codecId: 'pg/int4@1' } },
                },
                relations: {},
              },
            },
          },
        },
      },
      storage: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            entries: {
              table: {
                audit: {
                  columns: {
                    id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                    action: {
                      nativeType: 'text',
                      codecId: 'pg/text@1',
                      nullable: false,
                      valueSet: {
                        plane: 'storage',
                        entityKind: 'valueSet',
                        namespaceId: UNBOUND_NAMESPACE_ID,
                        entityName: 'AuditAction',
                      },
                    },
                  },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
              },
              valueSet: {
                AuditAction: { kind: 'valueSet', values: ['create', 'update', 'delete'] },
              },
            },
          },
        },
      },
    });

    const dts = generateContractDts(
      contract,
      sqlEmission,
      [],
      testHashes,
      undefined,
      identityCodecLookup,
    );

    expect(dts).toContain('readonly action: "create" | "update" | "delete"');
    const fieldOutputMatch = dts.match(/export type FieldOutputTypes = ({[\s\S]*?});/);
    expect(fieldOutputMatch).not.toBeNull();
    const fieldOutputBlock = fieldOutputMatch![0];
    expect(fieldOutputBlock).not.toContain('action');
    expect(fieldOutputBlock).toContain('id');
  });

  it('derives FieldOutputTypes enum entry as plain literal union from StorageColumnTypes', () => {
    const contract = createContract({
      domain: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            models: {
              Post: {
                storage: {
                  namespaceId: UNBOUND_NAMESPACE_ID,
                  table: 'post',
                  fields: { priority: { column: 'priority' } },
                },
                fields: {
                  priority: {
                    nullable: false,
                    type: { kind: 'scalar', codecId: 'pg/text@1' },
                    valueSet: {
                      plane: 'domain',
                      entityKind: 'enum',
                      namespaceId: UNBOUND_NAMESPACE_ID,
                      entityName: 'Priority',
                    },
                  },
                },
                relations: {},
              },
            },
            enum: {
              Priority: {
                codecId: 'pg/text@1',
                members: [
                  { name: 'Low', value: 'low' },
                  { name: 'High', value: 'high' },
                  { name: 'Urgent', value: 'urgent' },
                ],
              },
            },
          },
        },
      },
      storage: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            entries: {
              table: {
                post: {
                  columns: {
                    priority: {
                      nativeType: 'text',
                      codecId: 'pg/text@1',
                      nullable: false,
                      valueSet: {
                        plane: 'storage',
                        entityKind: 'valueSet',
                        namespaceId: UNBOUND_NAMESPACE_ID,
                        entityName: 'Priority',
                      },
                    },
                  },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
              },
              valueSet: {
                Priority: { kind: 'valueSet', values: ['low', 'high', 'urgent'] },
              },
            },
          },
        },
      },
    });

    const dts = generateContractDts(
      contract,
      sqlEmission,
      [],
      testHashes,
      undefined,
      identityCodecLookup,
    );

    // FieldOutputTypes must show the plain literal union, not a ContractBase expression.
    expect(dts).toContain('readonly priority: "low" | "high" | "urgent"');
    expect(dts).not.toContain('ContractBase[');
    expect(dts).not.toContain('["members"][number]');
  });

  it('bakes the parameterized-codec-refined type for a typeRef column (not the raw accessor)', () => {
    const contract = createContract({
      domain: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            models: {
              Post: {
                storage: {
                  namespaceId: UNBOUND_NAMESPACE_ID,
                  table: 'post',
                  fields: { embedding: { column: 'embedding' } },
                },
                fields: {
                  embedding: {
                    nullable: true,
                    type: { kind: 'scalar', codecId: 'pg/vector@1' },
                  },
                },
                relations: {},
              },
            },
          },
        },
      },
      storage: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            entries: {
              table: {
                post: {
                  columns: {
                    embedding: {
                      nativeType: 'vector',
                      codecId: 'pg/vector@1',
                      nullable: true,
                      typeRef: 'Embedding1536',
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
        types: {
          Embedding1536: {
            codecId: 'pg/vector@1',
            nativeType: 'vector',
            typeParams: { length: 1536 },
          },
        },
      },
    });

    const dts = generateContractDts(
      contract,
      sqlEmission,
      [],
      testHashes,
      undefined,
      vectorCodecLookup(),
    );

    const storageColumnMatch = dts.match(/export type StorageColumnTypes = ({.+?});/s);
    expect(storageColumnMatch).not.toBeNull();
    // The refined codec output is baked in, NOT the raw codec accessor.
    expect(storageColumnMatch![0]).toContain('readonly embedding: Vector<1536> | null');
    expect(storageColumnMatch![0]).not.toContain('CodecTypes["pg/vector@1"]["output"]');
  });

  it('emits a StorageColumnInputTypes map (param-refined input side)', () => {
    const contract = createContract({
      domain: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            models: {
              Post: {
                storage: {
                  namespaceId: UNBOUND_NAMESPACE_ID,
                  table: 'post',
                  fields: { embedding: { column: 'embedding' }, title: { column: 'title' } },
                },
                fields: {
                  embedding: { nullable: false, type: { kind: 'scalar', codecId: 'pg/vector@1' } },
                  title: { nullable: false, type: { kind: 'scalar', codecId: 'pg/text@1' } },
                },
                relations: {},
              },
            },
          },
        },
      },
      storage: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            entries: {
              table: {
                post: {
                  columns: {
                    embedding: {
                      nativeType: 'vector',
                      codecId: 'pg/vector@1',
                      nullable: false,
                      typeRef: 'Embedding1536',
                    },
                    title: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
                  },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
              },
            },
          },
        },
        types: {
          Embedding1536: {
            codecId: 'pg/vector@1',
            nativeType: 'vector',
            typeParams: { length: 1536 },
          },
        },
      },
    });

    const dts = generateContractDts(
      contract,
      sqlEmission,
      [],
      testHashes,
      undefined,
      vectorCodecLookup(),
    );

    const inputMatch = dts.match(/export type StorageColumnInputTypes = ({.+?});/s);
    expect(inputMatch).not.toBeNull();
    // Refined input render for the parameterized column; codec input accessor for the plain one.
    expect(inputMatch![0]).toContain('readonly embedding: VectorInput<1536>');
    expect(inputMatch![0]).toContain('readonly title: CodecTypes["pg/text@1"]["input"]');
  });

  it('narrows StorageColumnInputTypes to the value-set union for an enum column', () => {
    const contract = createContract({
      domain: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            models: {
              Post: {
                storage: {
                  namespaceId: UNBOUND_NAMESPACE_ID,
                  table: 'post',
                  fields: { priority: { column: 'priority' } },
                },
                fields: {
                  priority: {
                    nullable: false,
                    type: { kind: 'scalar', codecId: 'pg/text@1' },
                    valueSet: {
                      plane: 'domain',
                      entityKind: 'enum',
                      namespaceId: UNBOUND_NAMESPACE_ID,
                      entityName: 'Priority',
                    },
                  },
                },
                relations: {},
              },
            },
          },
        },
      },
      storage: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            entries: {
              table: {
                post: {
                  columns: {
                    priority: {
                      nativeType: 'text',
                      codecId: 'pg/text@1',
                      nullable: false,
                      valueSet: {
                        plane: 'storage',
                        entityKind: 'valueSet',
                        namespaceId: UNBOUND_NAMESPACE_ID,
                        entityName: 'Priority',
                      },
                    },
                  },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
              },
              valueSet: {
                Priority: { kind: 'valueSet', values: ['low', 'high', 'urgent'] },
              },
            },
          },
        },
      },
    });

    const dts = generateContractDts(
      contract,
      sqlEmission,
      [],
      testHashes,
      undefined,
      identityCodecLookup,
    );

    const inputMatch = dts.match(/export type StorageColumnInputTypes = ({.+?});/s);
    expect(inputMatch).not.toBeNull();
    expect(inputMatch![0]).toContain('readonly priority: "low" | "high" | "urgent"');
  });

  it('FieldOutputTypes uses the field element codec for a many[] field, not the storage column codec', () => {
    const contract = createContract({
      models: {
        Config: {
          storage: {
            table: 'config',
            fields: { tags: { column: 'tags' } },
          },
          fields: {
            tags: {
              nullable: false,
              many: true,
              type: { kind: 'scalar', codecId: 'pg/text@1' },
            },
          },
          relations: {},
        },
      },
      storage: {
        tables: {
          config: {
            columns: {
              tags: { nativeType: 'jsonb', codecId: 'pg/jsonb@1', nullable: false },
            },
            primaryKey: { columns: ['tags'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const dts = generateContractDts(contract, sqlEmission, [], testHashes);

    const fieldOutputMatch = dts.match(/export type FieldOutputTypes = ({.+?});/s);
    expect(fieldOutputMatch).not.toBeNull();
    expect(fieldOutputMatch![0]).toContain(
      'readonly tags: ReadonlyArray<CodecTypes["pg/text@1"]["output"]>',
    );
    expect(fieldOutputMatch![0]).not.toContain('jsonb');

    const storageColumnMatch = dts.match(/export type StorageColumnTypes = ({.+?});/s);
    expect(storageColumnMatch).not.toBeNull();
    expect(storageColumnMatch![0]).toContain('readonly tags: CodecTypes["pg/jsonb@1"]["output"]');
  });

  function nonIdentityEnumColumnContract() {
    return createContract({
      domain: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            models: {
              Item: {
                storage: {
                  namespaceId: UNBOUND_NAMESPACE_ID,
                  table: 'item',
                  fields: { level: { column: 'level' } },
                },
                fields: {
                  level: {
                    nullable: false,
                    type: { kind: 'scalar', codecId: NON_IDENTITY_CODEC_ID },
                  },
                },
                relations: {},
              },
            },
          },
        },
      },
      storage: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            entries: {
              table: {
                item: {
                  columns: {
                    level: {
                      nativeType: 'int4',
                      codecId: NON_IDENTITY_CODEC_ID,
                      nullable: false,
                      valueSet: {
                        plane: 'storage',
                        entityKind: 'valueSet',
                        namespaceId: UNBOUND_NAMESPACE_ID,
                        entityName: 'Level',
                      },
                    },
                  },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
              },
              valueSet: {
                // Encoded form is integers; the codec decodes them to string literals.
                Level: { kind: 'valueSet', values: [0, 1, 2] },
              },
            },
          },
        },
      },
    });
  }

  it("types a non-identity enum column as the codec's decoded output, not the encoded literal", () => {
    const dts = generateContractDts(
      nonIdentityEnumColumnContract(),
      sqlEmission,
      [],
      testHashes,
      undefined,
      nonIdentityCodecLookup,
    );

    const storageColumnMatch = dts.match(/export type StorageColumnTypes = ({.+?});/s);
    expect(storageColumnMatch).not.toBeNull();
    // Codec OUTPUT (decoded literals), not the raw encoded ints 0 | 1 | 2.
    expect(storageColumnMatch![0]).toContain('readonly level: "low" | "high" | "urgent"');
    expect(storageColumnMatch![0]).not.toContain('0 | 1 | 2');
  });

  it('falls back to the codec output type when a value is not literal-expressible', () => {
    const fallbackLookup: CodecLookup = {
      get: () => undefined,
      targetTypesFor: () => undefined,
      renderOutputTypeFor: (id) => (id === NON_IDENTITY_CODEC_ID ? 'Level' : undefined),
      // Returns undefined for every value, forcing the codec-output fallback.
      renderValueLiteralFor: () => undefined,
    };

    const dts = generateContractDts(
      nonIdentityEnumColumnContract(),
      sqlEmission,
      [],
      testHashes,
      undefined,
      fallbackLookup,
    );

    const storageColumnMatch = dts.match(/export type StorageColumnTypes = ({.+?});/s);
    expect(storageColumnMatch).not.toBeNull();
    expect(storageColumnMatch![0]).toContain(
      `readonly level: CodecTypes["${NON_IDENTITY_CODEC_ID}"]["output"]`,
    );
    expect(storageColumnMatch![0]).not.toContain('0 | 1 | 2');
  });

  it('falls back to the codec output type when no codec lookup is supplied', () => {
    const dts = generateContractDts(nonIdentityEnumColumnContract(), sqlEmission, [], testHashes);

    const storageColumnMatch = dts.match(/export type StorageColumnTypes = ({.+?});/s);
    expect(storageColumnMatch).not.toBeNull();
    expect(storageColumnMatch![0]).toContain(
      `readonly level: CodecTypes["${NON_IDENTITY_CODEC_ID}"]["output"]`,
    );
  });

  it("types a non-identity enum FIELD (via its column) as the codec's decoded output, not the encoded literal", () => {
    const dts = generateContractDts(
      nonIdentityEnumColumnContract(),
      sqlEmission,
      [],
      testHashes,
      undefined,
      nonIdentityCodecLookup,
    );

    const fieldOutputMatch = dts.match(/export type FieldOutputTypes = ({.+?});/s);
    expect(fieldOutputMatch).not.toBeNull();
    // The SQL field resolves through its column's value set, so the FIELD type matches the COLUMN
    // type: the codec OUTPUT (decoded literals), not the raw encoded ints 0 | 1 | 2.
    expect(fieldOutputMatch![0]).toContain('readonly level: "low" | "high" | "urgent"');
    expect(fieldOutputMatch![0]).not.toContain('0 | 1 | 2');

    // Field type and column type must be byte-identical.
    const storageColumnMatch = dts.match(/export type StorageColumnTypes = ({.+?});/s);
    expect(storageColumnMatch![0]).toContain('readonly level: "low" | "high" | "urgent"');
  });

  describe('a native-enum column (pg/enum@1, value-set-typed, no domain enum)', () => {
    // Mirrors a native Postgres enum column: codecId 'pg/enum@1', a storage
    // valueSet ref, NO domain field valueSet (a native enum never creates a
    // domain enum — authoring-design.md §0/§2.5). Typing must flow through
    // the exact same value-set → codec path a check-enum column uses
    // (querying-design.md §2.1) — no new typing code.
    function nativeEnumColumnContract() {
      return createContract({
        domain: {
          namespaces: {
            [UNBOUND_NAMESPACE_ID]: {
              models: {
                AuthSession: {
                  storage: {
                    namespaceId: UNBOUND_NAMESPACE_ID,
                    table: 'authSession',
                    fields: { aal: { column: 'aal' } },
                  },
                  fields: {
                    aal: { nullable: false, type: { kind: 'scalar', codecId: 'pg/enum@1' } },
                  },
                  relations: {},
                },
              },
            },
          },
        },
        storage: {
          namespaces: {
            [UNBOUND_NAMESPACE_ID]: {
              id: UNBOUND_NAMESPACE_ID,
              entries: {
                table: {
                  authSession: {
                    columns: {
                      aal: {
                        nativeType: 'aal_level',
                        codecId: 'pg/enum@1',
                        nullable: false,
                        valueSet: {
                          plane: 'storage',
                          entityKind: 'valueSet',
                          namespaceId: UNBOUND_NAMESPACE_ID,
                          entityName: 'AalLevel',
                        },
                      },
                    },
                    uniques: [],
                    indexes: [],
                    foreignKeys: [],
                  },
                },
                valueSet: {
                  AalLevel: { kind: 'valueSet', values: ['aal1', 'aal2', 'aal3'] },
                },
              },
            },
          },
        },
      });
    }

    function pgEnumCodecLookup(): CodecLookup {
      return {
        get: () => undefined,
        targetTypesFor: () => undefined,
        renderOutputTypeFor: () => undefined,
        renderValueLiteralFor: (id, value) =>
          id === 'pg/enum@1' ? renderTsLiteral(value) : undefined,
      };
    }

    it('types the column as the member-value literal union (StorageColumnTypes)', () => {
      const dts = generateContractDts(
        nativeEnumColumnContract(),
        sqlEmission,
        [],
        testHashes,
        undefined,
        pgEnumCodecLookup(),
      );

      const storageColumnMatch = dts.match(/export type StorageColumnTypes = ({.+?});/s);
      expect(storageColumnMatch).not.toBeNull();
      expect(storageColumnMatch![0]).toContain('readonly aal: "aal1" | "aal2" | "aal3"');
      expect(storageColumnMatch![0]).not.toContain('CodecTypes["pg/enum@1"]');
    });

    it('types the column input side as the same literal union (StorageColumnInputTypes)', () => {
      const dts = generateContractDts(
        nativeEnumColumnContract(),
        sqlEmission,
        [],
        testHashes,
        undefined,
        pgEnumCodecLookup(),
      );

      const inputMatch = dts.match(/export type StorageColumnInputTypes = ({.+?});/s);
      expect(inputMatch).not.toBeNull();
      expect(inputMatch![0]).toContain('readonly aal: "aal1" | "aal2" | "aal3"');
    });

    it('falls back to the codec output type when no codec lookup is supplied (no renderValueLiteral)', () => {
      const dts = generateContractDts(nativeEnumColumnContract(), sqlEmission, [], testHashes);

      const storageColumnMatch = dts.match(/export type StorageColumnTypes = ({.+?});/s);
      expect(storageColumnMatch).not.toBeNull();
      expect(storageColumnMatch![0]).toContain(`readonly aal: CodecTypes["pg/enum@1"]["output"]`);
    });

    it("also types FieldOutputTypes as the literal union, via the storage column's valueSet (no domain field valueSet involved)", () => {
      // The SQL family's `resolveFieldValueSet` SPI hook (emitter/src/index.ts)
      // resolves a field's value-set from its STORAGE COLUMN's `valueSet` ref —
      // not from a domain-field `valueSet`. `nativeEnumColumnContract()`'s
      // domain field carries no `valueSet` (no domain enum for a native
      // enum), yet FieldOutputTypes must still resolve the union — proving
      // ORM-side typing does not depend on a domain enum existing.
      const dts = generateContractDts(
        nativeEnumColumnContract(),
        sqlEmission,
        [],
        testHashes,
        undefined,
        pgEnumCodecLookup(),
      );

      const fieldOutputMatch = dts.match(/export type FieldOutputTypes = ({[\s\S]*?});/);
      expect(fieldOutputMatch).not.toBeNull();
      expect(fieldOutputMatch![0]).toContain('readonly aal: "aal1" | "aal2" | "aal3"');
    });
  });

  it('wraps StorageColumnTypes/StorageColumnInputTypes in ReadonlyArray for a native many[] column', () => {
    const contract = createContract({
      models: {
        Post: {
          storage: {
            table: 'post',
            fields: { tags: { column: 'tags' }, labels: { column: 'labels' } },
          },
          fields: {
            tags: { nullable: false, many: true, type: { kind: 'scalar', codecId: 'pg/text@1' } },
            labels: { nullable: true, many: true, type: { kind: 'scalar', codecId: 'pg/text@1' } },
          },
          relations: {},
        },
      },
      storage: {
        tables: {
          post: {
            columns: {
              tags: { nativeType: 'text', codecId: 'pg/text@1', nullable: false, many: true },
              labels: { nativeType: 'text', codecId: 'pg/text@1', nullable: true, many: true },
            },
            primaryKey: { columns: ['tags'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });

    const dts = generateContractDts(contract, sqlEmission, [], testHashes);

    const outputMatch = dts.match(/export type StorageColumnTypes = ({.+?});/s);
    expect(outputMatch).not.toBeNull();
    expect(outputMatch![0]).toContain(
      'readonly tags: ReadonlyArray<CodecTypes["pg/text@1"]["output"]>',
    );
    expect(outputMatch![0]).toContain(
      'readonly labels: ReadonlyArray<CodecTypes["pg/text@1"]["output"]> | null',
    );

    const inputMatch = dts.match(/export type StorageColumnInputTypes = ({.+?});/s);
    expect(inputMatch).not.toBeNull();
    expect(inputMatch![0]).toContain(
      'readonly tags: ReadonlyArray<CodecTypes["pg/text@1"]["input"]>',
    );
    expect(inputMatch![0]).toContain(
      'readonly labels: ReadonlyArray<CodecTypes["pg/text@1"]["input"]> | null',
    );
  });

  it('renders nullable elements inside the array before whole-column nullability', () => {
    const contract = createContract({
      models: {
        Post: {
          storage: {
            table: 'post',
            fields: {
              tags: { column: 'tags' },
              labels: { column: 'labels' },
              waived: { column: 'waived' },
              priorities: { column: 'priorities' },
              vectors: { column: 'vectors' },
            },
          },
          fields: {
            tags: {
              nullable: false,
              many: true,
              elementNullable: true,
              type: { kind: 'scalar', codecId: 'pg/text@1' },
            },
            labels: {
              nullable: true,
              many: true,
              elementNullable: true,
              type: { kind: 'scalar', codecId: 'pg/text@1' },
            },
            waived: {
              nullable: false,
              many: true,
              type: { kind: 'scalar', codecId: 'pg/text@1' },
            },
            priorities: {
              nullable: false,
              many: true,
              elementNullable: true,
              type: { kind: 'scalar', codecId: 'pg/text@1' },
            },
            vectors: {
              nullable: false,
              many: true,
              elementNullable: true,
              type: { kind: 'scalar', codecId: 'pg/vector@1', typeParams: { length: 3 } },
            },
          },
          relations: {},
        },
      },
      storage: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            entries: {
              table: {
                post: {
                  columns: {
                    tags: {
                      nativeType: 'text',
                      codecId: 'pg/text@1',
                      nullable: false,
                      many: true,
                      elementNullable: true,
                    },
                    labels: {
                      nativeType: 'text',
                      codecId: 'pg/text@1',
                      nullable: true,
                      many: true,
                      elementNullable: true,
                    },
                    waived: {
                      nativeType: 'text',
                      codecId: 'pg/text@1',
                      nullable: false,
                      many: true,
                      noCheck: ['elementNotNull'],
                    },
                    priorities: {
                      nativeType: 'text',
                      codecId: 'pg/text@1',
                      nullable: false,
                      many: true,
                      elementNullable: true,
                      valueSet: {
                        plane: 'storage',
                        namespaceId: UNBOUND_NAMESPACE_ID,
                        entityKind: 'valueSet',
                        entityName: 'Priority',
                      },
                    },
                    vectors: {
                      nativeType: 'vector',
                      codecId: 'pg/vector@1',
                      nullable: false,
                      many: true,
                      elementNullable: true,
                      typeParams: { length: 3 },
                    },
                  },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
              },
              valueSet: {
                Priority: { kind: 'valueSet', values: ['low', 'high'] },
              },
            },
          },
        },
      },
    });

    const dts = generateContractDts(
      contract,
      sqlEmission,
      [],
      testHashes,
      undefined,
      vectorCodecLookup(),
    );
    const outputMatch = dts.match(/export type StorageColumnTypes = ({.+?});/s);

    expect(outputMatch).not.toBeNull();
    expect(outputMatch![0]).toContain(
      'readonly tags: ReadonlyArray<CodecTypes["pg/text@1"]["output"] | null>',
    );
    expect(outputMatch![0]).toContain(
      'readonly labels: ReadonlyArray<CodecTypes["pg/text@1"]["output"] | null> | null',
    );
    expect(outputMatch![0]).toContain(
      'readonly waived: ReadonlyArray<CodecTypes["pg/text@1"]["output"]>',
    );
    expect(outputMatch![0]).not.toContain(
      'readonly waived: ReadonlyArray<CodecTypes["pg/text@1"]["output"] | null>',
    );
    expect(outputMatch![0]).toContain('readonly priorities: ReadonlyArray<"low" | "high" | null>');
    expect(outputMatch![0]).toContain('readonly vectors: ReadonlyArray<Vector<3> | null>');

    const inputMatch = dts.match(/export type StorageColumnInputTypes = ({.+?});/s);
    expect(inputMatch).not.toBeNull();
    expect(inputMatch![0]).toContain(
      'readonly tags: ReadonlyArray<CodecTypes["pg/text@1"]["input"] | null>',
    );
    expect(inputMatch![0]).toContain(
      'readonly labels: ReadonlyArray<CodecTypes["pg/text@1"]["input"] | null> | null',
    );
    expect(inputMatch![0]).toContain(
      'readonly waived: ReadonlyArray<CodecTypes["pg/text@1"]["input"]>',
    );
    expect(inputMatch![0]).not.toContain(
      'readonly waived: ReadonlyArray<CodecTypes["pg/text@1"]["input"] | null>',
    );
    expect(inputMatch![0]).toContain('readonly priorities: ReadonlyArray<"low" | "high" | null>');
    expect(inputMatch![0]).toContain('readonly vectors: ReadonlyArray<VectorInput<3> | null>');
  });
});
