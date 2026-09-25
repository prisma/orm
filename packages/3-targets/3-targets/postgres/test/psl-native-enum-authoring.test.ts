/**
 * Tests for PSL `native_enum` authoring:
 *
 *  1. Parse→lower: a `native_enum` block inside `namespace auth { … }` lowers
 *     to a `PostgresNativeEnum` with the `@@map`-derived (or defaulted)
 *     type name and ordered members.
 *
 *  2. Interpreter end-to-end: `interpretPslDocumentToSqlContract` on a doc with
 *     a `native_enum` block lowers it into `entries.native_enum` AND derives
 *     `entries.valueSet` from the same members — via the production factory
 *     chain (no test-side hand-lowering).
 *
 *  3. Negative: a bare (value-less) member is a diagnostic, not accepted.
 */

import { createDataTypeLookup } from '@internal/framework-components/codec';
import { assembleAuthoringContributions } from '@internal/framework-components/control';
import { buildSymbolTable, interpretExtensionBlocks } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import { postgresDataTypes } from '@internal/target-postgres/data-types';
import { describe, expect, it } from 'vitest';
import {
  postgresAuthoringEntityTypes,
  postgresAuthoringPslBlockDescriptors,
} from '../src/core/authoring';
import { PostgresNativeEnum } from '../src/core/postgres-native-enum';
import { PostgresSchema, postgresCreateNamespace } from '../src/core/postgres-schema';

const postgresDataTypeLookup = createDataTypeLookup(postgresDataTypes);

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

const scalarColumnDescriptors = new Map<string, { codecId: string; nativeType: string }>([
  ['String', { codecId: 'pg/text@1', nativeType: 'text' }],
  ['Int', { codecId: 'pg/int4@1', nativeType: 'int4' }],
]);

function parsePsl(source: string) {
  const { document, sources } = parse(source, 'psl-native-enum-authoring.test.psl');
  const { symbolTable, diagnostics: collectionDiagnostics } = buildSymbolTable({
    documents: [document],
    sources,
  });
  const blocks = interpretExtensionBlocks(symbolTable, sources, assembled.pslBlockDescriptors);
  return {
    symbolTable,
    diagnostics: [...collectionDiagnostics, ...blocks.diagnostics],
    parsedBlocks: blocks.parsedBlocks,
  };
}

function interpret(source: string) {
  const { document, sources } = parse(source, 'psl-native-enum-authoring.test.psl');
  const { symbolTable } = buildSymbolTable({ documents: [document], sources });
  return interpretPslDocumentToSqlContract({
    documents: [document],
    dataTypeLookup: postgresDataTypeLookup,
    symbolTable,
    sources,
    capabilities: {},
    target: postgresTarget,
    scalarColumnDescriptors,
    authoringContributions: assembled,
    composedExtensionContracts: new Map(),
    createNamespace: postgresCreateNamespace,
  });
}

describe('PSL native_enum parse → lower', () => {
  const source = `
namespace auth {
  native_enum AalLevel {
    aal1 = "aal1"
    aal2 = "aal2"
    aal3 = "aal3"
    @@map("aal_level")
  }

  model AuthSession {
    id Int @id
  }
}
`;

  it('parses the native_enum block without diagnostics', () => {
    const { diagnostics } = parsePsl(source);
    expect(diagnostics).toEqual([]);
  });

  it('places the parsed block in the auth namespace with a native_enum envelope', () => {
    const { symbolTable, parsedBlocks } = parsePsl(source);
    const authNs = symbolTable.topLevel.namespaces['auth'];
    expect(authNs).toBeDefined();
    const blocks = Object.values(authNs!.blocks);
    expect(blocks).toHaveLength(1);
    expect(parsedBlocks.get(blocks[0]!)).toMatchObject({ kind: 'native_enum', name: 'AalLevel' });
  });
});

describe('interpretPslDocumentToSqlContract native_enum → entries.native_enum + entries.valueSet', () => {
  it('lowers a native_enum block to entries.native_enum with @@map type name and ordered members', () => {
    const source = `
namespace auth {
  native_enum AalLevel {
    aal1 = "aal1"
    aal2 = "aal2"
    aal3 = "aal3"
    @@map("aal_level")
  }

  model AuthSession {
    id Int @id
  }
}
`;
    const result = interpret(source);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ns = result.value.storage.namespaces['auth'] as PostgresSchema;
    expect(ns).toBeInstanceOf(PostgresSchema);
    expect(Object.keys(ns.entries.native_enum ?? {})).toHaveLength(1);

    const nativeEnum = ns.entries.native_enum?.['aal_level'];
    expect(nativeEnum).toBeInstanceOf(PostgresNativeEnum);
    expect(nativeEnum?.typeName).toBe('aal_level');
    expect(nativeEnum?.members).toEqual(['aal1', 'aal2', 'aal3']);
  });

  it('unescapes a backslash-bearing @@map type name symmetrically with the printer escape', () => {
    // The inferred-PSL printer escapes `\` → `\\` and `"` → `\"` in @@map
    // arguments; lowering must invert both, or a round-tripped type name
    // gains escape characters.
    const source = `
namespace auth {
  native_enum Weird {
    a = "a"
    @@map("back\\\\slash \\"quoted\\"")
  }

  model AuthSession {
    id Int @id
  }
}
`;
    const result = interpret(source);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ns = result.value.storage.namespaces['auth'] as PostgresSchema;
    const nativeEnum = ns.entries.native_enum?.['back\\slash "quoted"'];
    expect(nativeEnum?.typeName).toBe('back\\slash "quoted"');
  });

  it('leaves control unset — the effective grade resolves from the contract-level defaultControlPolicy, not a per-node stamp', () => {
    const source = `
namespace auth {
  native_enum AalLevel {
    aal1 = "aal1"
    @@map("aal_level")
  }

  model AuthSession {
    id Int @id
  }
}
`;
    const result = interpret(source);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ns = result.value.storage.namespaces['auth'] as PostgresSchema;
    const nativeEnum = ns.entries.native_enum?.['aal_level'];
    expect(Object.hasOwn(nativeEnum!, 'control')).toBe(false);
  });

  it('derives entries.valueSet from the native_enum members, in declaration order', () => {
    const source = `
namespace auth {
  native_enum AalLevel {
    aal1 = "aal1"
    aal2 = "aal2"
    aal3 = "aal3"
    @@map("aal_level")
  }

  model AuthSession {
    id Int @id
  }
}
`;
    const result = interpret(source);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ns = result.value.storage.namespaces['auth'] as PostgresSchema;
    const valueSet = ns.valueSet?.['AalLevel'];
    expect(valueSet).toBeDefined();
    expect(valueSet?.values).toEqual(['aal1', 'aal2', 'aal3']);
  });

  it('defaults typeName to the block name verbatim when @@map is omitted', () => {
    const source = `
namespace auth {
  native_enum FactorType {
    totp = "totp"
    webauthn = "webauthn"
  }

  model AuthSession {
    id Int @id
  }
}
`;
    const result = interpret(source);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ns = result.value.storage.namespaces['auth'] as PostgresSchema;
    const nativeEnum = ns.entries.native_enum?.['FactorType'];
    expect(nativeEnum?.typeName).toBe('FactorType');
  });

  it('does not create a domain enum entry (native enums never appear alongside db.enums)', () => {
    const source = `
namespace auth {
  native_enum AalLevel {
    aal1 = "aal1"
    @@map("aal_level")
  }

  model AuthSession {
    id Int @id
  }
}
`;
    const result = interpret(source);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const domainNs = result.value.domain.namespaces['auth'];
    expect(domainNs?.enum?.['AalLevel']).toBeUndefined();
  });
});

describe('PSL native_enum diagnostics', () => {
  it('a bare (value-less) member is rejected by the shared grammar, and interpretation fails without lowering', () => {
    const source = `
namespace auth {
  native_enum AalLevel {
    aal1
    aal2 = "aal2"
    @@map("aal_level")
  }
}
`;
    const { diagnostics } = parsePsl(source);
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_INVALID_EXTENSION_BLOCK_MEMBER',
        message: expect.stringContaining('"aal1"'),
      }),
    ]);

    const result = interpret(source);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_INVALID_EXTENSION_BLOCK_MEMBER',
        message: expect.stringContaining('"aal1"'),
      }),
    ]);
  });

  it('an empty native_enum (no members) emits PSL_NATIVE_ENUM_MISSING_MEMBERS', () => {
    const source = `
namespace auth {
  native_enum AalLevel {
    @@map("aal_level")
  }
}
`;
    const result = interpret(source);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'PSL_NATIVE_ENUM_MISSING_MEMBERS' }),
      ]),
    );
  });

  it('a duplicate member value emits PSL_NATIVE_ENUM_DUPLICATE_MEMBER_VALUE', () => {
    const source = `
namespace auth {
  native_enum AalLevel {
    a = "x"
    b = "x"
    @@map("aal_level")
  }
}
`;
    const result = interpret(source);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'PSL_NATIVE_ENUM_DUPLICATE_MEMBER_VALUE' }),
      ]),
    );
  });

  it('a duplicate member NAME is a parse-time PSL_EXTENSION_DUPLICATE_PARAMETER (first-wins) — same as the SQL enum block', () => {
    // Member keys bind through the shared entries spec, so the block
    // interpreter flags a repeated name at symbol-table time and keeps the
    // first occurrence. This is the exact behavior the SQL `enum` block has
    // (see interpreter.enum.test.ts); native_enum inherits it for free from
    // the shared grammar — no native_enum-specific handling, and no factory
    // runs for the invalid block.
    const source = `
namespace auth {
  native_enum AalLevel {
    aal1 = "x"
    aal1 = "y"
    @@map("aal_level")
  }
}
`;
    const { diagnostics } = parsePsl(source);
    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'PSL_EXTENSION_DUPLICATE_PARAMETER' }),
      ]),
    );
  });

  it('an argument-less @@map() is a symbol-table diagnostic from the kit', () => {
    const source = `
namespace auth {
  native_enum AalLevel {
    aal1 = "aal1"
    @@map()
  }
}
`;
    const { diagnostics } = parsePsl(source);

    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
        message: 'Attribute "map" is missing required argument "name"',
      }),
    ]);
  });

  it('a non-string member value is rejected by the shared grammar', () => {
    const source = `
namespace auth {
  native_enum AalLevel {
    aal1 = 42
    @@map("aal_level")
  }
}
`;
    const { diagnostics } = parsePsl(source);
    expect(diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
        message: 'Expected a string literal',
      }),
    ]);
  });
});
