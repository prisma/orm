/**
 * The contract-to-PSL printer over the Prisma 7 source's fixture corpus: each
 * `expected-contract.json` (the Prisma 7 source's own output, asserted by that
 * package's tests) is hydrated through the Postgres serializer and printed.
 * The print-then-interpret round trip lives in
 * `test/integration/test/prisma7-source/printer-round-trip.integration.test.ts`,
 * because interpreting needs the control stack and this package cannot depend
 * on it without a dependency cycle; here the printed text is held to the
 * spellings dispatch 1 settled by hand.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { assembleAuthoringContributions } from '@internal/framework-components/control';
import { printPsl } from '@internal/psl-printer';
import { dirname, join } from 'pathe';
import { describe, expect, it } from 'vitest';
import {
  postgresAuthoringEntityTypes,
  postgresAuthoringPslBlockDescriptors,
} from '../../src/core/authoring';
import { PostgresContractSerializer } from '../../src/core/postgres-contract-serializer';
import type { PostgresNamespaceEntries } from '../../src/core/postgres-schema';
import { printPostgresPslContract } from '../../src/core/psl-print/print-psl-contract';

const corpusDir = join(
  dirname(new URL(import.meta.url).pathname),
  '../../../../../2-sql/2-authoring/contract-prisma7/test/fixtures',
);

const { pslBlockDescriptors } = assembleAuthoringContributions([
  {
    authoring: {
      entityTypes: postgresAuthoringEntityTypes,
      pslBlockDescriptors: postgresAuthoringPslBlockDescriptors,
    },
  },
]);

function printFixture(name: string): string {
  const json: unknown = JSON.parse(
    readFileSync(join(corpusDir, name, 'expected-contract.json'), 'utf8'),
  );
  const contract = new PostgresContractSerializer().deserializeContract(json);
  return printPsl(printPostgresPslContract(contract), {
    header: '// Converted.',
    pslBlockDescriptors,
  }).replace(/ {2,}/g, ' ');
}

function loadFixture(name: string) {
  const json: unknown = JSON.parse(
    readFileSync(join(corpusDir, name, 'expected-contract.json'), 'utf8'),
  );
  return new PostgresContractSerializer().deserializeContract(json);
}

function withColumnTweak(name: string, columnPatch: Record<string, unknown> = {}) {
  const contract = loadFixture(name);
  if (Object.keys(columnPatch).length === 0) return contract;
  const table = name === 'scalars' ? 'Scalars' : 'User';
  const column = 'dateTime';
  const namespace = contract.storage.namespaces['public'];
  const tableEntry = namespace?.entries.table?.[table];
  return {
    ...contract,
    storage: {
      ...contract.storage,
      namespaces: {
        ...contract.storage.namespaces,
        public: {
          ...namespace,
          entries: {
            ...namespace?.entries,
            table: {
              ...namespace?.entries.table,
              [table]: {
                ...tableEntry,
                columns: {
                  ...tableEntry?.columns,
                  [column]: { ...tableEntry?.columns[column], ...columnPatch },
                },
              },
            },
          },
        },
      },
    },
  };
}

/** Every Prisma 7 fixture with an `expected-contract.json`; a new fixture raises this and the integration round trip's count together. */
const CORPUS_CASE_COUNT = 20;

const corpus = readdirSync(corpusDir)
  .filter((name) =>
    statSync(join(corpusDir, name, 'expected-contract.json'), { throwIfNoEntry: false })?.isFile(),
  )
  .sort();

describe('printPostgresPslContract', () => {
  it('prints every fixture of the Prisma 7 corpus', () => {
    expect(corpus.length).toBe(CORPUS_CASE_COUNT);
    for (const name of corpus) {
      expect(printFixture(name)).toContain('// use prisma-8\n// Converted.\n');
    }
  });

  it('spells scalars with the constructors that reproduce the Prisma 7 columns', () => {
    const printed = printFixture('scalars');
    expect(printed).toContain('decimal Numeric(65, 30)');
    expect(printed).toContain('dateTime Timestamp(3)');
    expect(printed).toContain('json Jsonb');
    expect(printed).toContain('stringList String[]? @noCheck(elementNotNull)');
    expect(printed).toContain('@@map("Scalars")');
  });

  it('spells native enums as blocks with @@map and pg.enum references', () => {
    const printed = printFixture('enum-native');
    expect(printed).toContain('native_enum Role {');
    expect(printed).toContain('@@map("user_role")');
    expect(printed).toContain('role pg.enum(Role)');
    expect(printed).toContain('roleList pg.enum(Role)[]? @noCheck(elementNotNull)');
    expect(printed).toContain('namespace audit {');
    expect(printed).toContain('native_enum AuditAction {');
  });

  it('spells defaults: exact BigInt digits, JSON text, generators, raw expressions, enum values', () => {
    const printed = printFixture('defaults');
    expect(printed).toContain('@default(9007199254740993)');
    expect(printed).toContain('@default("{\\"a\\":1}")');
    expect(printed).toContain('@default(dbgenerated("gen_random_uuid()"))');
    expect(printed).toContain(`@default(dbgenerated("'\\\\x68656c6c6f'"))`);
    expect(printed).toContain('enumMember pg.enum(Role) @default("user")');
    expect(printed).toContain('@default(["a", "b"])');
  });

  it('spells execution generators as their Prisma 8 calls', () => {
    const printed = printFixture('generators');
    expect(printed).toContain('uuid4 String @default(uuid(4))');
    expect(printed).toContain('uuid7 String @default(uuid(7))');
    expect(printed).toContain('cuid1 String @default(cuid(2))');
    expect(printed).toContain('ulid String @default(ulid())');
    expect(printed).toContain('nanoid String @default(nanoid())');
    expect(printed).toContain('nanoidSized String @default(nanoid(10))');
  });

  it('spells @updatedAt columns as temporal presets', () => {
    const printed = printFixture('updated-at');
    expect(printed).toContain('updatedAt temporal.timestamp(3, onCreate: now, onUpdate: now)');
    expect(printed).toContain('updatedAtTz temporal.timestamptz(6, onCreate: now, onUpdate: now)');
  });

  it('spells indexes with map:, unique:, type: and options: {}', () => {
    const printed = printFixture('indexes');
    expect(printed).toContain('@@index([slug], unique: true, map: "posts_slug_key")');
    expect(printed).toContain(
      '@@index([hashed], type: "hash", options: {}, map: "posts_hashed_idx")',
    );
    expect(printed).toContain('@@map("posts")');
  });

  it('spells foreign keys with both actions, index: false, and names only where pairing is ambiguous', () => {
    const printed = printFixture('explicit-relations');
    expect(printed).toContain(
      'author User @relation("PostAuthor", fields: [authorId], references: [id], onDelete: Restrict, onUpdate: Cascade, index: false)',
    );
    expect(printed).toContain('posts Post[] @relation("PostAuthor")');
    expect(printed).toContain(
      'user User @relation(fields: [userId], references: [id], onDelete: Cascade, onUpdate: Cascade, index: false)',
    );
    expect(printed).toContain('profile Profile?');
    expect(printed).toContain('@@index([userId], unique: true, map: "Profile_userId_key")');
  });

  it('spells implicit junctions as models and names self-referential pairs per side', () => {
    const printed = printFixture('implicit-many-to-many');
    expect(printed).toContain('@@map("_Follows")');
    expect(printed).toContain('followers User[] @relation("Followers")');
    expect(printed).toContain('following User[] @relation("Following")');
    expect(printed).toContain('favorites Post[]\n');
    expect(printed).toContain('fans User[]\n');
    expect(printed).toContain(
      'a Post @relation(fields: [A], references: [id], onDelete: Cascade, onUpdate: Cascade, index: false)',
    );
    expect(printed).toContain('tags Tag[]\n');
    expect(printed).toContain('@@index([B], map: "_PostToTag_B_index")');
  });

  it('spells an enum value that is not a PSL identifier through a sanitized member label', () => {
    const contract = loadFixture('enum-native');
    const publicEntries: PostgresNamespaceEntries | undefined =
      contract.storage.namespaces['public']?.entries;
    const nativeEnum = publicEntries?.native_enum?.['user_role'];
    const spaced = {
      ...contract,
      storage: {
        ...contract.storage,
        namespaces: {
          ...contract.storage.namespaces,
          public: {
            ...contract.storage.namespaces['public'],
            entries: {
              ...contract.storage.namespaces['public']?.entries,
              native_enum: {
                user_role: { ...nativeEnum, members: ['user role', 'ADMIN'] },
              },
            },
          },
        },
      },
    };
    const printed = printPsl(printPostgresPslContract(spaced as never), {
      header: '// Converted.',
      pslBlockDescriptors,
    }).replace(/ {2,}/g, ' ');
    expect(printed).toContain('userRole = "user role"');
    expect(printed).toContain('ADMIN = "ADMIN"');
  });

  it('refuses a type param the constructor cannot carry, naming the model and field', () => {
    const contract = withColumnTweak('scalars', { typeParams: { precision: 3, zone: 'utc' } });
    expect(() => printPostgresPslContract(contract as never)).toThrow(
      /Model "Scalars", field "dateTime": type params "zone"/,
    );
  });

  it('names an unused enum whose type name is not an identifier by a sanitized block name with @@map', () => {
    const contract = loadFixture('enum-native');
    const publicEntries: PostgresNamespaceEntries | undefined =
      contract.storage.namespaces['public']?.entries;
    const renamed = {
      ...contract,
      storage: {
        ...contract.storage,
        namespaces: {
          ...contract.storage.namespaces,
          public: {
            ...contract.storage.namespaces['public'],
            entries: {
              ...publicEntries,
              native_enum: {
                ...publicEntries?.native_enum,
                'order-status': {
                  ...publicEntries?.native_enum?.['Unused'],
                  typeName: 'order-status',
                  members: ['open', 'closed'],
                },
              },
            },
          },
        },
      },
    };
    const printed = printPsl(printPostgresPslContract(renamed as never), {
      header: '// Converted.',
      pslBlockDescriptors,
    }).replace(/ {2,}/g, ' ');
    expect(printed).toContain('native_enum OrderStatus {');
    expect(printed).toContain('@@map("order-status")');
    expect(printed).toContain('open = "open"');
  });

  it('gives two unused enums whose sanitized names collide distinct block names', () => {
    const contract = loadFixture('enum-native');
    const publicEntries: PostgresNamespaceEntries | undefined =
      contract.storage.namespaces['public']?.entries;
    const unused = publicEntries?.native_enum?.['Unused'];
    const colliding = {
      ...contract,
      storage: {
        ...contract.storage,
        namespaces: {
          ...contract.storage.namespaces,
          public: {
            ...contract.storage.namespaces['public'],
            entries: {
              ...publicEntries,
              native_enum: {
                ...publicEntries?.native_enum,
                'order-status': { ...unused, typeName: 'order-status', members: ['open'] },
                order_status: { ...unused, typeName: 'order_status', members: ['closed'] },
              },
            },
          },
        },
      },
    };
    const printed = printPsl(printPostgresPslContract(colliding as never), {
      header: '// Converted.',
      pslBlockDescriptors,
    }).replace(/ {2,}/g, ' ');
    expect(printed).toContain('native_enum OrderStatus {');
    expect(printed).toContain('native_enum OrderStatus2 {');
    expect(printed).toContain('@@map("order-status")');
    expect(printed).toContain('@@map("order_status")');
  });

  it('refuses a construct with no spelling by naming the model and field', () => {
    const json: unknown = JSON.parse(
      readFileSync(join(corpusDir, 'scalars', 'expected-contract.json'), 'utf8'),
    );
    const contract = new PostgresContractSerializer().deserializeContract(json);
    const withUnknownCodec = {
      ...contract,
      storage: {
        ...contract.storage,
        namespaces: {
          ...contract.storage.namespaces,
          public: {
            ...contract.storage.namespaces['public'],
            entries: {
              ...contract.storage.namespaces['public']?.entries,
              table: {
                ...contract.storage.namespaces['public']?.entries.table,
                Scalars: {
                  ...contract.storage.namespaces['public']?.entries.table?.['Scalars'],
                  columns: {
                    ...contract.storage.namespaces['public']?.entries.table?.['Scalars']?.columns,
                    string: {
                      ...contract.storage.namespaces['public']?.entries.table?.['Scalars']?.columns[
                        'string'
                      ],
                      codecId: 'pg/citext@1',
                    },
                  },
                },
              },
            },
          },
        },
      },
    };
    expect(() => printPostgresPslContract(withUnknownCodec as never)).toThrow(
      /Model "Scalars", field "string": codec "pg\/citext@1"/,
    );
  });
});
