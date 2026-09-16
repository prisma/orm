import { crossRef } from '@internal/contract/types';
import { defineIndexTypes } from '@internal/sql-contract/index-types';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import {
  type InterpretPslDocumentToSqlContractInput,
  interpretPslDocumentToSqlContract as interpretPslDocumentToSqlContractInternal,
} from '../src/interpreter';
import {
  createBuiltinLikeControlMutationDefaults,
  modelsOf,
  postgresScalarTypeDescriptors,
  postgresTarget,
  symbolTableInputFromParseArgs,
  testEnumEntityContributions,
} from './fixtures';
import { sqlStorageFromSuccessfulSqlInterpretation } from './interpret-sql-contract-storage';
import { unboundTables } from './unbound-tables';

const testIndexPack = {
  kind: 'extension',
  id: 'test-index-pack',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  indexTypes: defineIndexTypes().add('bm25', { options: type('object') }),
} as const;

describe('interpretPslDocumentToSqlContract', () => {
  const builtinControlMutationDefaults = createBuiltinLikeControlMutationDefaults();
  const interpretPslDocumentToSqlContract = (
    input: Omit<
      InterpretPslDocumentToSqlContractInput,
      | 'target'
      | 'scalarColumnDescriptors'
      | 'composedExtensionContracts'
      | 'createNamespace'
      | 'capabilities'
    > &
      Partial<Pick<InterpretPslDocumentToSqlContractInput, 'composedExtensionContracts'>>,
  ) =>
    interpretPslDocumentToSqlContractInternal({
      target: postgresTarget,
      scalarColumnDescriptors: postgresScalarTypeDescriptors,
      authoringContributions: { entityTypes: testEnumEntityContributions, type: {}, field: {} },
      composedExtensionContracts: new Map(),
      createNamespace: createTestSqlNamespace,
      capabilities: { sql: { scalarList: true } },
      ...input,
    });

  it('uses composed scalar type descriptors without hardcoded fallback', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model User {
  id Int @id
  email String
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContractInternal({
      ...document,
      target: postgresTarget,
      scalarColumnDescriptors: new Map([
        ['Int', { codecId: 'pg/int4@1', nativeType: 'int4' }],
        ['String', { codecId: 'custom/text@1', nativeType: 'custom_text' }],
      ]),
      composedExtensionContracts: new Map(),
      controlMutationDefaults: builtinControlMutationDefaults,
      createNamespace: createTestSqlNamespace,
      capabilities: { sql: { scalarList: true } },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.storage).toMatchObject({
      namespaces: {
        public: {
          entries: {
            table: {
              User: {
                columns: {
                  email: {
                    codecId: 'custom/text@1',
                    nativeType: 'custom_text',
                  },
                },
              },
            },
          },
        },
      },
    });
    expect(result.value.roots).toEqual({ User: crossRef('User', 'public') });
  });

  it('does not synthesise capabilities the target did not contribute', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model User {
  id Int @id
  email String
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({ ...document });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The test `postgresTarget` fixture has `capabilities: {}`; with no
    // extension packs and no author-declared capabilities, the interpreter
    // must not inject anything of its own. Adapter and driver contributions
    // are layered in later by CLI emit, not here.
    expect(result.value.capabilities).toEqual({});
  });

  it('flows capabilities declared on the target pack through to the contract', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model User {
  id Int @id
  email String
}`,
      sourceId: 'schema.prisma',
    });

    const targetWithCapabilities = {
      ...postgresTarget,
      capabilities: { sql: { returning: true }, postgres: { lateral: true } },
    } as const;

    const result = interpretPslDocumentToSqlContractInternal({
      ...document,
      target: targetWithCapabilities,
      scalarColumnDescriptors: postgresScalarTypeDescriptors,
      authoringContributions: { entityTypes: testEnumEntityContributions, type: {}, field: {} },
      composedExtensionContracts: new Map(),
      createNamespace: createTestSqlNamespace,
      capabilities: { sql: { scalarList: true } },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.capabilities).toEqual({
      sql: { returning: true },
      postgres: { lateral: true },
    });
  });

  it('does not derive generated column type without descriptor resolver', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model User {
  id Int @id
  slug String @default(slugid())
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContractInternal({
      ...document,
      target: postgresTarget,
      scalarColumnDescriptors: postgresScalarTypeDescriptors,
      composedExtensionContracts: new Map(),
      capabilities: { sql: { scalarList: true } },
      controlMutationDefaults: {
        defaultFunctionRegistry: new Map([
          [
            'slugid',
            {
              signature: {
                documentation:
                  'Generates a slug identifier without changing the field’s storage type.',
              },
              lower: () => ({
                ok: true as const,
                value: {
                  kind: 'execution' as const,
                  generated: { kind: 'generator' as const, id: 'slugid' },
                },
              }),
              usageSignatures: ['slugid()'],
            },
          ],
        ]),
        generatorDescriptors: [{ id: 'slugid', applicableCodecIds: ['pg/text@1'] }],
      },
      createNamespace: createTestSqlNamespace,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.storage).toMatchObject({
      namespaces: {
        public: {
          entries: {
            table: {
              User: {
                columns: {
                  slug: {
                    codecId: 'pg/text@1',
                    nativeType: 'text',
                  },
                },
              },
            },
          },
        },
      },
    });
  });

  it('populates roots from models', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model User {
  id Int @id
  email String
}

model Post {
  id Int @id
  title String
  userId Int
  author User @relation(fields: [userId], references: [id])
}

model Comment {
  id Int @id
  body String
  postId Int
  post Post @relation(fields: [postId], references: [id])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.roots).toEqual({
      User: crossRef('User', 'public'),
      Post: crossRef('Post', 'public'),
      Comment: crossRef('Comment', 'public'),
    });
  });

  it('builds sql contract ir from simple psl schema', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model User {
  id Int @id
  email String
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.targetFamily).toBe('sql');
    expect(result.value.target).toBe('postgres');
    expect(result.value.roots).toEqual({ User: crossRef('User', 'public') });
    expect(result.value.storage).toMatchObject({
      namespaces: {
        public: {
          entries: {
            table: {
              User: {
                columns: {
                  id: { codecId: 'pg/int4@1', nativeType: 'int4' },
                  email: { codecId: 'pg/text@1', nativeType: 'text' },
                },
                primaryKey: { columns: ['id'] },
              },
            },
          },
        },
      },
    });
    expect(modelsOf(result.value)).toMatchObject({
      User: {
        storage: {
          namespaceId: 'public',
          table: 'User',
          fields: {
            id: { column: 'id' },
            email: { column: 'email' },
          },
        },
      },
    });
  });

  it('emits sql model with no @id and no @@id', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model IdlessThing {
  email String @unique
  token String
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.storage).toMatchObject({
      namespaces: {
        public: {
          entries: {
            table: {
              IdlessThing: {
                columns: {
                  email: { codecId: 'pg/text@1', nativeType: 'text' },
                  token: { codecId: 'pg/text@1', nativeType: 'text' },
                },
                uniques: [{ columns: ['email'] }],
              },
            },
          },
        },
      },
    });
    // `toMatchObject` with `primaryKey: undefined` requires the key to be
    // present — assert absence directly via a narrowed accessor instead.
    const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
    expect(unboundTables(storage)['IdlessThing']?.primaryKey).toBeUndefined();
    expect(modelsOf(result.value)).toMatchObject({
      IdlessThing: {
        storage: {
          namespaceId: 'public',
          table: 'IdlessThing',
          fields: {
            email: { column: 'email' },
            token: { column: 'token' },
          },
        },
      },
    });
  });

  it('emits composite model id as primary key', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model CompositeThing {
  email String
  token String

  @@id([email, token])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.storage).toMatchObject({
      namespaces: {
        public: {
          entries: {
            table: {
              CompositeThing: {
                primaryKey: { columns: ['email', 'token'] },
              },
            },
          },
        },
      },
    });
  });

  it('emits mapped composite model id name and columns', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model CompositeThing {
  email String @map("email_address")
  token String @map("api_token")

  @@id([email, token], map: "composite_thing_pkey")
  @@map("composite_thing")
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.storage).toMatchObject({
      namespaces: {
        public: {
          entries: {
            table: {
              composite_thing: {
                primaryKey: {
                  columns: ['email_address', 'api_token'],
                  name: 'composite_thing_pkey',
                },
              },
            },
          },
        },
      },
    });
  });

  it('names the storage table after the model verbatim when there is no @@map', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model UserProfile {
  id Int @id
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.roots).toEqual({ UserProfile: crossRef('UserProfile', 'public') });
    expect(Object.keys(result.value.storage.namespaces['public']!.entries['table'] ?? {})).toEqual([
      'UserProfile',
    ]);
  });

  it('maps @@map and @map to storage table and column names', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model Team {
  id Int @id @map("team_id")
  @@map("org_team")
}

model Member {
  id Int @id @map("member_id")
  teamId Int @map("team_ref")
  team Team @relation(fields: [teamId], references: [id])
  @@map("team_member")
  @@index([teamId])
  @@unique([teamId, id])
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.roots).toEqual({
      org_team: crossRef('Team', 'public'),
      team_member: crossRef('Member', 'public'),
    });
    expect(result.value.storage).toMatchObject({
      namespaces: {
        public: {
          entries: {
            table: {
              org_team: {
                columns: {
                  team_id: { codecId: 'pg/int4@1', nativeType: 'int4' },
                },
                primaryKey: { columns: ['team_id'] },
              },
              team_member: {
                columns: {
                  member_id: { codecId: 'pg/int4@1', nativeType: 'int4' },
                  team_ref: { codecId: 'pg/int4@1', nativeType: 'int4' },
                },
                primaryKey: { columns: ['member_id'] },
                indexes: [{ columns: ['team_ref'] }],
                uniques: [{ columns: ['team_ref', 'member_id'] }],
                foreignKeys: [
                  {
                    source: {
                      namespaceId: 'public',
                      tableName: 'team_member',
                      columns: ['team_ref'],
                    },
                    target: {
                      namespaceId: 'public',
                      tableName: 'org_team',
                      columns: ['team_id'],
                    },
                  },
                ],
              },
            },
          },
        },
      },
    });
    expect(modelsOf(result.value)).toMatchObject({
      Team: {
        storage: {
          namespaceId: 'public',
          table: 'org_team',
          fields: { id: { column: 'team_id' } },
        },
      },
      Member: {
        storage: {
          namespaceId: 'public',
          table: 'team_member',
          fields: {
            id: { column: 'member_id' },
            teamId: { column: 'team_ref' },
          },
        },
      },
    });
  });

  // Round-trip companion to packages/2-sql/9-family/test/psl-contract-infer/print-psl/print-psl.core.test.ts
  // The PSL strings below are copied verbatim from the printer's snapshots so
  // a drift on either side breaks one of the two suites. Spec: id-less SQL
  // tables and composite-PK tables emitted by introspection must round-trip
  // through the SQL PSL interpreter.
  describe('round-trips printer output', () => {
    it('accepts the printer output for an id-less table', () => {
      const printed = `// Contract inferred from the live database schema. Edit as needed, then run \`prisma contract emit\`.

// WARNING: This table has no primary key in the database
model AuditLog {
  event     String
  timestamp DateTime

  @@map("audit_log")
}
`;
      const document = symbolTableInputFromParseArgs({
        schema: printed,
        sourceId: 'schema.prisma',
      });
      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
      expect(unboundTables(storage)['audit_log']?.primaryKey).toBeUndefined();
      expect(modelsOf(result.value)).toMatchObject({
        AuditLog: { storage: { namespaceId: 'public', table: 'audit_log' } },
      });
    });

    it('accepts the printer output for a composite-PK table', () => {
      const printed = `// Contract inferred from the live database schema. Edit as needed, then run \`prisma contract emit\`.

model OrderItem {
  orderId   Int @map("order_id")
  productId Int @map("product_id")
  quantity  Int

  @@id([orderId, productId], map: "order_item_pkey")
  @@map("order_item")
}
`;
      const document = symbolTableInputFromParseArgs({
        schema: printed,
        sourceId: 'schema.prisma',
      });
      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.storage).toMatchObject({
        namespaces: {
          public: {
            entries: {
              table: {
                order_item: {
                  primaryKey: {
                    columns: ['order_id', 'product_id'],
                    name: 'order_item_pkey',
                  },
                },
              },
            },
          },
        },
      });
    });
  });

  it('maps model-level composite primary keys to storage columns', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model Membership {
  orgId String @map("org_id")
  userId String @map("user_id")

  @@id([orgId, userId], map: "membership_pkey")
  @@map("membership")
}
`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.storage).toMatchObject({
      namespaces: {
        public: {
          entries: {
            table: {
              membership: {
                primaryKey: { columns: ['org_id', 'user_id'], name: 'membership_pkey' },
              },
            },
          },
        },
      },
    });
  });

  describe('@@index type and options', () => {
    it('lowers @@index([body], type: "bm25", options: { key_field: "id" }) to an IR index node with type and options', () => {
      const document = symbolTableInputFromParseArgs({
        schema: `model Doc {
  id Int @id
  body String
  @@index([body], type: "bm25", options: { key_field: "id" }, map: "doc_body_bm25_idx")
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
        composedExtensions: [testIndexPack.id],
        composedExtensionPackRefs: [testIndexPack],
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.value.storage).toMatchObject({
        namespaces: {
          public: {
            entries: {
              table: {
                Doc: {
                  indexes: [
                    {
                      columns: ['body'],
                      name: 'doc_body_bm25_idx',
                      type: 'bm25',
                      options: { key_field: 'id' },
                    },
                  ],
                },
              },
            },
          },
        },
      });
    });

    it('accepts a multi-key options object with string-literal leaves', () => {
      const document = symbolTableInputFromParseArgs({
        schema: `model Doc {
  id Int @id
  body String
  @@index([body], type: "bm25", options: { key_field: "id", language: "en" })
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
        composedExtensions: [testIndexPack.id],
        composedExtensionPackRefs: [testIndexPack],
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.storage).toMatchObject({
        namespaces: {
          public: {
            entries: {
              table: {
                Doc: {
                  indexes: [{ type: 'bm25', options: { key_field: 'id', language: 'en' } }],
                },
              },
            },
          },
        },
      });
    });

    it('rejects a non-string-literal leaf in options (boolean)', () => {
      const document = symbolTableInputFromParseArgs({
        schema: `model Doc {
  id Int @id
  body String
  @@index([body], type: "bm25", options: { key_field: "id", fastupdate: false })
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(
        result.failure.diagnostics.some((d) => /Expected a string literal/.test(d.message)),
      ).toBe(true);
    });

    it('rejects a non-string-literal leaf in options (number)', () => {
      const document = symbolTableInputFromParseArgs({
        schema: `model Doc {
  id Int @id
  body String
  @@index([body], type: "bm25", options: { fillfactor: 70 })
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(
        result.failure.diagnostics.some((d) => /Expected a string literal/.test(d.message)),
      ).toBe(true);
    });

    it('rejects an options argument with no surrounding type argument', () => {
      const document = symbolTableInputFromParseArgs({
        schema: `model Doc {
  id Int @id
  body String
  @@index([body], options: { key_field: "id" })
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(
        result.failure.diagnostics.some((d) =>
          /options argument requires a type argument/.test(d.message),
        ),
      ).toBe(true);
    });

    it('rejects a malformed options object literal', () => {
      const document = symbolTableInputFromParseArgs({
        schema: `model Doc {
  id Int @id
  body String
  @@index([body], type: "bm25", options: { not_an_assignment })
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(
        result.failure.diagnostics.some(
          (d) =>
            d.code === 'PSL_INVALID_ATTRIBUTE_SYNTAX' &&
            d.message.includes('Expected a string literal'),
        ),
      ).toBe(true);
    });

    it('accepts @@index without type or options (existing behaviour unchanged)', () => {
      const document = symbolTableInputFromParseArgs({
        schema: `model Doc {
  id Int @id
  body String
  @@index([body])
}`,
        sourceId: 'schema.prisma',
      });

      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
      expect(unboundTables(storage)['Doc']).toMatchObject({
        indexes: [{ columns: ['body'] }],
      });
    });
  });

  describe('per-target namespace resolution', () => {
    it('Postgres leaves implicit top-level declarations on the late-bound default slot (TS/PSL byte parity for single-namespace contracts)', () => {
      const document = symbolTableInputFromParseArgs({
        schema: `model User {
  id Int @id
}
`,
        sourceId: 'schema.prisma',
      });
      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
      const table = unboundTables(storage)['User'];
      expect(table).toBeDefined();
      const json = JSON.parse(JSON.stringify(table)) as Record<string, unknown>;
      expect(json).not.toHaveProperty('namespaceId');
    });

    it('Postgres lowers `namespace unbound { … }` to the late-binding sentinel slot', () => {
      const document = symbolTableInputFromParseArgs({
        schema: `namespace unbound {
  model Tenant {
    id Int @id
  }
}
`,
        sourceId: 'schema.prisma',
      });
      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
      const tenant = unboundTables(storage)['Tenant'];
      expect(tenant).toBeDefined();
      const json = JSON.parse(JSON.stringify(tenant)) as Record<string, unknown>;
      expect(json).not.toHaveProperty('namespaceId');
    });

    it('Postgres lowers named `namespace auth { … }` to its eponymous schema slot', () => {
      const document = symbolTableInputFromParseArgs({
        schema: `namespace auth {
  model User {
    id Int @id
  }
}
`,
        sourceId: 'schema.prisma',
      });
      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
      const user = storage.namespaces['auth']!.entries.table?.['User'];
      expect(user).toBeDefined();
      expect(unboundTables(storage)['User']).toBeUndefined();
      const json = JSON.parse(JSON.stringify(user)) as Record<string, unknown>;
      expect(json).not.toHaveProperty('namespaceId');
    });

    it('Postgres routes a mixed top-level + multi-namespace document into the right slots', () => {
      const document = symbolTableInputFromParseArgs({
        schema: `model Post {
  id Int @id
}

namespace auth {
  model User {
    id Int @id
  }
}

namespace logs {
  model AuditLog {
    id Int @id
  }
}
`,
        sourceId: 'schema.prisma',
      });
      const result = interpretPslDocumentToSqlContract({
        ...document,
        controlMutationDefaults: builtinControlMutationDefaults,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
      expect(unboundTables(storage)['Post']).toBeDefined();
      expect(storage.namespaces['auth']!.entries.table?.['User']).toBeDefined();
      expect(storage.namespaces['logs']!.entries.table?.['AuditLog']).toBeDefined();
      expect(unboundTables(storage)['User']).toBeUndefined();
    });
  });
});
