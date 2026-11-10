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

/** The one-line declaration of a type overrides map, or `''` when the file has none. */
function typeOverrides(dts: string, name: 'ColumnTypeOverrides' | 'FieldTypeOverrides'): string {
  return dts.match(new RegExp(`^type ${name} = (.*);$`, 'm'))?.[1] ?? '';
}

/** The emitted storage column of `table.column`, as `ContractBase` carries it. */
function storageColumn(dts: string, column: string): string {
  return dts.match(new RegExp(`readonly ${column}: \\{ readonly dataType: [^}]*\\}`))?.[0] ?? '';
}

function vectorCodecLookup(): CodecLookup {
  return {
    get: () => undefined,
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
                    many: false,
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
                      dataType: 'pg/text',
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

    expect(dts).toContain(
      'export type StorageColumnTypes = ColumnTypesFromStorage<ContractBase[\'storage\'], CodecTypes, ParameterizedOutputTypeFunctions, ColumnTypeOverrides, "output">;',
    );
    expect(typeOverrides(dts, 'ColumnTypeOverrides')).toContain(
      'readonly priority: { readonly output: "low" | "high" | "urgent"; readonly input: "low" | "high" | "urgent" }',
    );
    expect(dts).not.toContain('["members"][number]');
  });

  it('gives a non-enum column no type override, so its codec types it', () => {
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
                  email: {
                    nullable: false,
                    many: false,
                    type: { kind: 'scalar', codecId: 'pg/text@1' },
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
                user: {
                  columns: {
                    email: { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false },
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

    expect(dts).toContain('export type StorageColumnTypes = ColumnTypesFromStorage<');
    expect(typeOverrides(dts, 'ColumnTypeOverrides')).toBe('{  }');
    expect(storageColumn(dts, 'email')).toContain('readonly codecId: "pg/text@1"');
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
                    many: false,
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
                      dataType: 'pg/int4',
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

    expect(typeOverrides(dts, 'ColumnTypeOverrides')).toContain(
      'readonly level: { readonly output: 1 | 2; readonly input: 1 | 2 }',
    );
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
                  name: {
                    nullable: false,
                    many: false,
                    type: { kind: 'scalar', codecId: 'pg/text@1' },
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
                tag: {
                  columns: {
                    name: { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false },
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
                  id: {
                    nullable: false,
                    many: false,
                    type: { kind: 'scalar', codecId: 'pg/int4@1' },
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
                audit: {
                  columns: {
                    id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
                    action: {
                      dataType: 'pg/text',
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

    expect(typeOverrides(dts, 'ColumnTypeOverrides')).toContain(
      'readonly action: { readonly output: "create" | "update" | "delete"; readonly input: "create" | "update" | "delete" }',
    );
    expect(typeOverrides(dts, 'FieldTypeOverrides')).not.toContain('action');
  });

  it('gives a storage namespace that holds only value sets no column type overrides', () => {
    const contract = createContract({
      domain: {
        namespaces: {
          app: {
            models: {
              Audit: {
                storage: { namespaceId: 'app', table: 'audit', fields: { id: { column: 'id' } } },
                fields: {
                  id: {
                    nullable: false,
                    many: false,
                    type: { kind: 'scalar', codecId: 'pg/int4@1' },
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
          shared: {
            id: 'shared',
            entries: {
              valueSet: {
                AuditAction: { kind: 'valueSet', values: ['create', 'delete'] },
              },
            },
          },
          app: {
            id: 'app',
            entries: {
              table: {
                audit: {
                  columns: {
                    id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
                    action: {
                      dataType: 'pg/text',
                      codecId: 'pg/text@1',
                      nullable: false,
                      valueSet: {
                        plane: 'storage',
                        entityKind: 'valueSet',
                        namespaceId: 'shared',
                        entityName: 'AuditAction',
                      },
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

    expect(typeOverrides(dts, 'ColumnTypeOverrides')).toBe(
      '{ readonly app: { readonly audit: { readonly action: { readonly output: "create" | "delete"; readonly input: "create" | "delete" } } } }',
    );
  });

  it('gives an enum field the literal union of its column value set as its type override', () => {
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
                    many: false,
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
                      dataType: 'pg/text',
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

    expect(typeOverrides(dts, 'FieldTypeOverrides')).toContain(
      'readonly priority: { readonly output: "low" | "high" | "urgent"; readonly input: "low" | "high" | "urgent" }',
    );
    expect(dts).not.toContain('["members"][number]');
  });

  it("gives a column the type its codec renders for the column's type parameters", () => {
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
                    many: false,
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
                      dataType: 'pgvector/vector',
                      codecId: 'pg/vector@1',
                      nullable: true,
                      typeParams: { length: 1536 },
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

    expect(typeOverrides(dts, 'ColumnTypeOverrides')).toContain(
      'readonly embedding: { readonly output: Vector<1536>; readonly input: VectorInput<1536> }',
    );
  });

  it('emits a StorageColumnInputTypes map, with the input type a codec renders as an override', () => {
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
                  embedding: {
                    nullable: false,
                    many: false,
                    type: { kind: 'scalar', codecId: 'pg/vector@1' },
                  },
                  title: {
                    nullable: false,
                    many: false,
                    type: { kind: 'scalar', codecId: 'pg/text@1' },
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
                      dataType: 'pgvector/vector',
                      codecId: 'pg/vector@1',
                      nullable: false,
                      typeParams: { length: 1536 },
                    },
                    title: { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false },
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

    const dts = generateContractDts(
      contract,
      sqlEmission,
      [],
      testHashes,
      undefined,
      vectorCodecLookup(),
    );

    expect(dts).toContain(
      'export type StorageColumnInputTypes = ColumnTypesFromStorage<ContractBase[\'storage\'], CodecTypes, ParameterizedOutputTypeFunctions, ColumnTypeOverrides, "input">;',
    );
    expect(typeOverrides(dts, 'ColumnTypeOverrides')).toContain(
      'readonly input: VectorInput<1536>',
    );
    expect(typeOverrides(dts, 'ColumnTypeOverrides')).not.toContain('title');
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
                    many: false,
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
                      dataType: 'pg/text',
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

    expect(typeOverrides(dts, 'ColumnTypeOverrides')).toContain(
      'readonly priority: { readonly output: "low" | "high" | "urgent"; readonly input: "low" | "high" | "urgent" }',
    );
  });

  it('types a many[] field from its domain field, whose element codec differs from its storage column codec', () => {
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
              many: { elementNullable: false },
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
              tags: { dataType: 'pg/jsonb', codecId: 'pg/jsonb@1', nullable: false },
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

    expect(dts).toContain(
      "export type FieldOutputTypes = FieldTypesFromDomain<ContractBase['domain']['namespaces'], CodecTypes, ParameterizedOutputTypeFunctions, FieldTypeOverrides, \"output\", ContractBase['storage']['namespaces']>;",
    );
    expect(dts).toContain(
      'readonly tags: { readonly nullable: false; readonly type: { readonly kind: "scalar"; readonly codecId: "pg/text@1" }; readonly many: { readonly elementNullable: false } }',
    );
    expect(storageColumn(dts, 'tags')).toContain('readonly codecId: "pg/jsonb@1"');
    expect(typeOverrides(dts, 'FieldTypeOverrides')).toBe('{  }');
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
                    many: false,
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
                      dataType: 'pg/int4',
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

    // Codec OUTPUT (decoded literals), not the raw encoded ints 0 | 1 | 2.
    expect(typeOverrides(dts, 'ColumnTypeOverrides')).toContain(
      'readonly level: { readonly output: "low" | "high" | "urgent"; readonly input: "low" | "high" | "urgent" }',
    );
    expect(typeOverrides(dts, 'ColumnTypeOverrides')).not.toContain('0 | 1 | 2');
  });

  it('falls back to the codec output type when a value is not literal-expressible', () => {
    const fallbackLookup: CodecLookup = {
      get: () => undefined,
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

    expect(typeOverrides(dts, 'ColumnTypeOverrides')).toBe('{  }');
  });

  it('falls back to the codec output type when no codec lookup is supplied', () => {
    const dts = generateContractDts(nonIdentityEnumColumnContract(), sqlEmission, [], testHashes);

    expect(typeOverrides(dts, 'ColumnTypeOverrides')).toBe('{  }');
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

    // The SQL field resolves through its column's value set, so the FIELD type matches the COLUMN
    // type: the codec OUTPUT (decoded literals), not the raw encoded ints 0 | 1 | 2.
    const override =
      'readonly level: { readonly output: "low" | "high" | "urgent"; readonly input: "low" | "high" | "urgent" }';
    expect(typeOverrides(dts, 'FieldTypeOverrides')).toContain(override);
    expect(typeOverrides(dts, 'ColumnTypeOverrides')).toContain(override);
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
                    aal: {
                      nullable: false,
                      many: false,
                      type: { kind: 'scalar', codecId: 'pg/enum@1' },
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
                  authSession: {
                    columns: {
                      aal: {
                        dataType: 'pg/enum',
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

      expect(typeOverrides(dts, 'ColumnTypeOverrides')).toContain(
        'readonly aal: { readonly output: "aal1" | "aal2" | "aal3";',
      );
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

      expect(typeOverrides(dts, 'ColumnTypeOverrides')).toContain(
        'readonly input: "aal1" | "aal2" | "aal3" }',
      );
    });

    it('falls back to the codec output type when no codec lookup is supplied (no renderValueLiteral)', () => {
      const dts = generateContractDts(nativeEnumColumnContract(), sqlEmission, [], testHashes);

      expect(typeOverrides(dts, 'ColumnTypeOverrides')).toBe('{  }');
    });

    it("also types FieldOutputTypes as the literal union, via the storage column's valueSet (no domain field valueSet involved)", () => {
      // The SQL family's `resolveStorageValueSet` SPI hook (emitter/src/index.ts)
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

      expect(typeOverrides(dts, 'FieldTypeOverrides')).toContain(
        'readonly aal: { readonly output: "aal1" | "aal2" | "aal3"; readonly input: "aal1" | "aal2" | "aal3" }',
      );
    });
  });

  it('carries the list and nullability of a native many[] column for the column type generic to apply', () => {
    const contract = createContract({
      models: {
        Post: {
          storage: {
            table: 'post',
            fields: { tags: { column: 'tags' }, labels: { column: 'labels' } },
          },
          fields: {
            tags: {
              nullable: false,
              many: { elementNullable: false },
              type: { kind: 'scalar', codecId: 'pg/text@1' },
            },
            labels: {
              nullable: true,
              many: { elementNullable: false },
              type: { kind: 'scalar', codecId: 'pg/text@1' },
            },
          },
          relations: {},
        },
      },
      storage: {
        tables: {
          post: {
            columns: {
              tags: {
                dataType: 'pg/text',
                codecId: 'pg/text@1',
                nullable: false,
                many: { elementNullable: false },
              },
              labels: {
                dataType: 'pg/text',
                codecId: 'pg/text@1',
                nullable: true,
                many: { elementNullable: false },
              },
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

    expect(storageColumn(dts, 'tags')).toContain(
      'readonly nullable: false; readonly many: { readonly elementNullable: false }',
    );
    expect(storageColumn(dts, 'labels')).toContain(
      'readonly nullable: true; readonly many: { readonly elementNullable: false }',
    );
    expect(typeOverrides(dts, 'ColumnTypeOverrides')).toBe('{  }');
  });

  it('carries element and column nullability apart, and gives overrides without the list', () => {
    const contract = createContract({
      models: {
        Post: {
          storage: {
            table: 'post',
            fields: {
              tags: { column: 'tags' },
              labels: { column: 'labels' },
              priorities: { column: 'priorities' },
              vectors: { column: 'vectors' },
            },
          },
          fields: {
            tags: {
              nullable: false,
              many: { elementNullable: true },
              type: { kind: 'scalar', codecId: 'pg/text@1' },
            },
            labels: {
              nullable: true,
              many: { elementNullable: true },
              type: { kind: 'scalar', codecId: 'pg/text@1' },
            },
            priorities: {
              nullable: false,
              many: { elementNullable: true },
              type: { kind: 'scalar', codecId: 'pg/text@1' },
            },
            vectors: {
              nullable: false,
              many: { elementNullable: true },
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
                      dataType: 'pg/text',
                      codecId: 'pg/text@1',
                      nullable: false,
                      many: { elementNullable: true },
                    },
                    labels: {
                      dataType: 'pg/text',
                      codecId: 'pg/text@1',
                      nullable: true,
                      many: { elementNullable: true },
                    },
                    priorities: {
                      dataType: 'pg/text',
                      codecId: 'pg/text@1',
                      nullable: false,
                      many: { elementNullable: true },
                      valueSet: {
                        plane: 'storage',
                        namespaceId: UNBOUND_NAMESPACE_ID,
                        entityKind: 'valueSet',
                        entityName: 'Priority',
                      },
                    },
                    vectors: {
                      dataType: 'pgvector/vector',
                      codecId: 'pg/vector@1',
                      nullable: false,
                      many: { elementNullable: true },
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
    expect(storageColumn(dts, 'tags')).toContain(
      'readonly many: { readonly elementNullable: true }',
    );
    expect(storageColumn(dts, 'labels')).toContain(
      'readonly nullable: true; readonly many: { readonly elementNullable: true }',
    );
    const override = typeOverrides(dts, 'ColumnTypeOverrides');
    expect(override).toContain(
      'readonly priorities: { readonly output: "low" | "high"; readonly input: "low" | "high" }',
    );
    expect(override).toContain(
      'readonly vectors: { readonly output: Vector<3>; readonly input: VectorInput<3> }',
    );
    expect(override).not.toContain('ReadonlyArray');
  });
});
