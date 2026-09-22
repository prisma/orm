/**
 * The recovered output must re-parse and re-interpret without diagnostics:
 * the enum lowers to a value set, the column types by it, and a recovered
 * default lowers as the member's value.
 */
import sqlFamilyPack from '@internal/family-sql/pack';
import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import { collectScalarTypeConstructors } from '@internal/framework-components/authoring';
import type { Codec, CodecLookup } from '@internal/framework-components/codec';
import { assembleAuthoringContributions } from '@internal/framework-components/control';
import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import { assert, describe, expect, it } from 'vitest';
import {
  postgresAuthoringEntityTypes,
  postgresAuthoringPslBlockDescriptors,
} from '../../src/core/authoring';
import { isPostgresSchema, postgresCreateNamespace } from '../../src/core/postgres-schema';
import {
  idColumn,
  inferAndPrint,
  membershipCheck,
  namespaceNode,
  table,
  tree,
} from './enum-recovery-fixtures';

const authoringTypes = {
  Int: { kind: 'typeConstructor', output: { codecId: 'pg/int4@1', nativeType: 'int4' } },
  String: { kind: 'typeConstructor', output: { codecId: 'pg/text@1', nativeType: 'text' } },
} as const satisfies AuthoringTypeNamespace;

const assembled = assembleAuthoringContributions([
  { authoring: sqlFamilyPack.authoring },
  {
    authoring: {
      entityTypes: postgresAuthoringEntityTypes,
      type: authoringTypes,
      pslBlockDescriptors: postgresAuthoringPslBlockDescriptors,
    },
  },
]);

const target = {
  kind: 'target' as const,
  familyId: 'sql' as const,
  targetId: 'postgres' as const,
  id: 'postgres',
  version: '0.0.1',
  capabilities: {},
  defaultNamespaceId: 'public',
  authoring: { type: authoringTypes },
};

const textCodec: Codec = {
  id: 'pg/text@1',
  encode: async (v: unknown) => v,
  decode: async (w: unknown) => w,
  encodeJson: (value) => value as never,
  decodeJson(json) {
    if (typeof json !== 'string') throw new Error(`expected string, got ${typeof json}`);
    return json;
  },
};

const codecLookup: CodecLookup = {
  get: (id) => (id === 'pg/text@1' ? textCodec : undefined),
  targetTypesFor: (id) => (id === 'pg/text@1' ? ['text'] : undefined),
  renderOutputTypeFor: () => undefined,
  descriptorFor: () => undefined,
};

function parseAndInterpret(source: string) {
  const { document, sources, diagnostics: parseDiagnostics } = parse(source, 'schema.prisma');
  const { symbolTable, diagnostics: symbolTableDiagnostics } = buildSymbolTable({
    documents: [document],
    sources,
    pslBlockDescriptors: assembled.pslBlockDescriptors,
  });
  const interpreted = interpretPslDocumentToSqlContract({
    document,
    symbolTable,
    sources,
    capabilities: {},
    target,
    scalarColumnDescriptors: collectScalarTypeConstructors(authoringTypes),
    authoringContributions: assembled,
    composedExtensionContracts: new Map(),
    createNamespace: postgresCreateNamespace,
    codecLookup,
  });
  return { interpreted, sourceDiagnostics: [...parseDiagnostics, ...symbolTableDiagnostics] };
}

describe('recovered output re-parses and re-interprets without diagnostics', () => {
  it('the recovered text enum lowers to a value set and a valueSet-typed column', () => {
    const output = inferAndPrint(
      tree({
        public: namespaceNode('public', {
          accounts: table(
            'accounts',
            {
              id: idColumn,
              role: {
                name: 'role',
                nativeType: 'text',
                nullable: false,
                default: `'user'::text`,
              },
            },
            [
              membershipCheck(
                'accounts',
                'role',
                false,
                ['user', 'admin'],
                `(role = ANY (ARRAY['user'::text, 'admin'::text]))`,
              ),
            ],
          ),
        }),
      }),
    );

    const { interpreted, sourceDiagnostics } = parseAndInterpret(output);
    expect(sourceDiagnostics.map((d) => `${d.code}: ${d.message}`)).toEqual([]);
    if (!interpreted.ok) {
      assert.fail(interpreted.failure.diagnostics.map((d) => `${d.code}: ${d.message}`).join('\n'));
    }

    const publicStorage = interpreted.value.storage.namespaces['public'];
    assert.ok(isPostgresSchema(publicStorage), 'the value set must land in the public namespace');
    expect(publicStorage.valueSet?.['AccountsRole']).toMatchObject({
      values: ['user', 'admin'],
    });
    expect(publicStorage.table?.['accounts']?.columns['role']).toMatchObject({
      nullable: false,
      valueSet: {
        plane: 'storage',
        entityKind: 'valueSet',
        namespaceId: 'public',
        entityName: 'AccountsRole',
      },
    });
  });
});
