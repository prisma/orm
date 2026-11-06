import type { Contract } from '@internal/contract/types';
import { createDataTypeLookup } from '@internal/framework-components/codec';
import { EMPTY_GENERATOR_FUNCTIONS } from '@internal/framework-components/components';
import { assembleAuthoringContributions } from '@internal/framework-components/control';
import { withSeedDiagnostics } from '@internal/psl-parser/interpret';
import { bindPslSchema } from '@internal/psl-parser/test';
import { printPsl } from '@internal/psl-printer';
import type { SqlStorage } from '@internal/sql-contract/types';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import {
  describeUnsupportedSqlAttribute,
  sqlAttributeSpecs,
} from '@internal/sql-contract-psl/attribute-specs';
import { sqlContextInput } from '@internal/sql-contract-psl/test';
import { postgresDataTypes } from '@internal/target-postgres/data-types';
import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import {
  postgresAuthoringEntityTypes,
  postgresAuthoringPslBlockDescriptors,
} from '../src/core/authoring';
import { createPostgresBuiltinCodecLookup } from '../src/core/codec-registry';
import { PostgresContractSerializer } from '../src/core/postgres-contract-serializer';
import { PostgresExtension } from '../src/core/postgres-extension';
import { type PostgresSchema, postgresCreateNamespace } from '../src/core/postgres-schema';
import { buildPostgresPslContract } from '../src/core/psl-print/psl-contract';
import { testBuildContext } from './psl-print/build-context';

const assembled = assembleAuthoringContributions([
  {
    authoring: {
      entityTypes: postgresAuthoringEntityTypes,
      pslBlockDescriptors: postgresAuthoringPslBlockDescriptors,
    },
  },
]);

const postgresTarget = {
  kind: 'target' as const,
  familyId: 'sql' as const,
  targetId: 'postgres' as const,
  id: 'postgres',
  version: '0.0.1',
  capabilities: {},
  defaultNamespaceId: 'public',
};

function interpret(
  source: string,
  composedExtensionContracts: ReadonlyMap<string, Contract> = new Map(),
) {
  const bound = bindPslSchema(source, {
    sourceId: 'psl-extension-authoring.test.psl',
    context: {
      composedExtensions: [...composedExtensionContracts.keys()],
      defaultNamespaceId: 'public',
      composedExtensionContracts,
      authoringContributions: {
        ...assembled,
        type: {
          Int: { kind: 'typeConstructor' as const, output: { codecId: 'pg/int4@1' } },
          ...assembled.type,
        },
        attributeSpecs: sqlAttributeSpecs,
      },
      pslDiagnostics: { describeUnsupportedAttribute: describeUnsupportedSqlAttribute },
      codecLookup: createPostgresBuiltinCodecLookup(),
      controlMutationDefaults: { defaultFunctionRegistry: new Map(), generatorDescriptors: [] },
      generatorFunctions: EMPTY_GENERATOR_FUNCTIONS,
      dataTypes: {
        entries: assembled.dataTypes,
        lookup: createDataTypeLookup(postgresDataTypes),
        dataTypeOfCodec: () => undefined,
      },
      resolvedInputs: [],
      capabilities: {},
    },
  });
  return withSeedDiagnostics(
    interpretPslDocumentToSqlContract({
      documents: bound.documents,
      sources: bound.sources,
      symbolTable: bound.symbolTable,
      binder: bound.binder,
      ...sqlContextInput(bound.context),
      target: postgresTarget,
      createNamespace: postgresCreateNamespace,
    }),
    bound.seedDiagnostics,
  );
}

function extensionsOf(result: ReturnType<typeof interpret>, namespaceId: string) {
  if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));
  return (result.value.storage.namespaces[namespaceId] as PostgresSchema).extension;
}

function packDeclaring(extension: string): Contract {
  return blindCast<Contract, 'only the storage of a composed pack contract is read here'>({
    target: 'postgres',
    targetFamily: 'sql',
    storage: {
      namespaces: {
        __unbound__: postgresCreateNamespace({
          id: '__unbound__',
          entries: {
            table: {},
            extension: { [extension]: new PostgresExtension({ name: extension }) },
          },
        }),
      },
    },
  });
}

describe('PSL extension blocks', () => {
  it('files a top-level extension under the default namespace', () => {
    const result = interpret(`
extension pg_trgm {}

model User {
  id Int @id
}
`);
    expect(extensionsOf(result, 'public')).toEqual({
      pg_trgm: new PostgresExtension({ name: 'pg_trgm' }),
    });
  });

  it('files an extension declared in a namespace block under that namespace', () => {
    const result = interpret(`
namespace extensions {
  extension postgis {}
}

model User {
  id Int @id
}
`);
    expect(extensionsOf(result, 'extensions')).toEqual({
      postgis: new PostgresExtension({ name: 'postgis' }),
    });
  });

  it('files an extension declared in namespace unbound under the unbound namespace', () => {
    const result = interpret(`
namespace unbound {
  extension pg_trgm {}
}

model User {
  id Int @id
}
`);
    expect(extensionsOf(result, '__unbound__')).toEqual({
      pg_trgm: new PostgresExtension({ name: 'pg_trgm' }),
    });
    expect(extensionsOf(result, 'public')).toEqual({});
  });

  it('serializes an unbound extension under __unbound__ in contract JSON', () => {
    const result = interpret(`
namespace unbound {
  extension pg_trgm {}
}

model User {
  id Int @id
}
`);
    if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));
    const json = JSON.parse(
      JSON.stringify(
        new PostgresContractSerializer().serializeContract(
          blindCast<Contract<SqlStorage>, 'the PSL interpreter yields a SQL contract'>(
            result.value,
          ),
        ),
      ),
    );
    expect(json.storage.namespaces.__unbound__.entries.extension).toEqual({
      pg_trgm: { kind: 'extension', name: 'pg_trgm' },
    });
  });

  it('refuses one extension declared in two namespaces', () => {
    const result = interpret(`
extension postgis {}

namespace extensions {
  extension postgis {}
}

model User {
  id Int @id
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_ENTITY_DECLARED_IN_MANY_NAMESPACES',
        message:
          'extension "postgis" is declared in namespaces "extensions" and "public"; declare it in one namespace only.',
      }),
    ]);
  });

  it('writes the unbound namespace as unbound when one extension is declared twice', () => {
    const result = interpret(`
extension pg_trgm {}

namespace unbound {
  extension pg_trgm {}
}

model User {
  id Int @id
}
`);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_ENTITY_DECLARED_IN_MANY_NAMESPACES',
        message:
          'extension "pg_trgm" is declared in namespaces "public" and "unbound"; declare it in one namespace only.',
      }),
    ]);
  });

  it.each([
    ['at the top level', 'extension vector {}', '"public"'],
    ['in a named namespace', 'namespace extensions {\n  extension vector {}\n}', '"extensions"'],
    ['in namespace unbound', 'namespace unbound {\n  extension vector {}\n}', '"unbound"'],
  ])('refuses an extension a composed pack declares, declared %s', (_, declaration, namespace) => {
    const result = interpret(
      `${declaration}\n\nmodel User {\n  id Int @id\n}\n`,
      new Map([['pgvector', packDeclaring('vector')]]),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_ENTITY_DECLARED_BY_PACK',
        message: `extension "vector" is declared in namespace ${namespace}, and extension pack "pgvector" declares it in namespace "unbound". Remove this declaration; the pack installs the extension.`,
      }),
    ]);
  });

  it('accepts an extension no composed pack declares', () => {
    const result = interpret(
      'extension pg_trgm {}\n\nmodel User {\n  id Int @id\n}\n',
      new Map([['pgvector', packDeclaring('vector')]]),
    );
    expect(extensionsOf(result, 'public')).toEqual({
      pg_trgm: new PostgresExtension({ name: 'pg_trgm' }),
    });
  });

  it('refuses a member in an extension block', () => {
    const result = interpret(`
extension pg_trgm {
  version = "1.6"
}
`);
    expect(result.ok).toBe(false);
  });
});

describe('contract print writes extension blocks', () => {
  const source = `
extension pg_trgm {}

namespace extensions {
  extension postgis {}
}

model User {
  id Int @id
}
`;

  function print(result: ReturnType<typeof interpret>): string {
    if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));
    return printPsl(
      buildPostgresPslContract(
        blindCast<Contract<SqlStorage>, 'the PSL interpreter yields a SQL contract'>(result.value),
        testBuildContext(),
      ),
      { pslBlockDescriptors: assembled.pslBlockDescriptors },
    );
  }

  it('writes each extension in the namespace that declares it', () => {
    expect(print(interpret(source))).toBe(
      [
        '// use prisma-8',
        '',
        'namespace extensions {',
        '  extension postgis {',
        '  }',
        '}',
        '',
        'namespace public {',
        '  model User {',
        '    id Int @id',
        '  }',
        '',
        '  extension pg_trgm {',
        '  }',
        '}',
        '',
      ].join('\n'),
    );
  });

  it('writes a hyphenated extension name as the block name, and reads it back', () => {
    const printed = print(interpret('extension uuid-ossp {}\n\nmodel User {\n  id Int @id\n}\n'));
    expect(printed).toContain(['  extension uuid-ossp {', '  }'].join('\n'));
    expect(extensionsOf(interpret(printed), 'public')).toEqual({
      'uuid-ossp': new PostgresExtension({ name: 'uuid-ossp' }),
    });
  });

  it('writes an unbound extension in namespace unbound, and reads it back', () => {
    const printed = print(
      interpret(
        'namespace unbound {\n  extension pg_trgm {}\n}\n\nmodel User {\n  id Int @id\n}\n',
      ),
    );
    expect(printed).toContain(
      ['namespace unbound {', '  extension pg_trgm {', '  }', '}'].join('\n'),
    );
    const reread = interpret(printed);
    expect(extensionsOf(reread, '__unbound__')).toEqual({
      pg_trgm: new PostgresExtension({ name: 'pg_trgm' }),
    });
    expect(extensionsOf(reread, 'public')).toEqual({});
  });

  it('reads back the extensions it printed', () => {
    const reread = interpret(print(interpret(source)));
    expect(extensionsOf(reread, 'public')).toEqual({
      pg_trgm: new PostgresExtension({ name: 'pg_trgm' }),
    });
    expect(extensionsOf(reread, 'extensions')).toEqual({
      postgis: new PostgresExtension({ name: 'postgis' }),
    });
  });
});
