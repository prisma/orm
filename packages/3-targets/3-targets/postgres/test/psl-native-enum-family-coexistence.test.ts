/**
 * `native_enum` + PSL family `enum` coexistence in one namespace. Depends on
 * the SQL family pack's `enum` block contribution, whose typed-spec
 * migration is the family packages' slice work — until that lands, the
 * family descriptor cannot compose against the typed registration contract
 * and this suite cannot run.
 */

import sqlFamilyPack from '@internal/family-sql/pack';
import type { Codec, CodecLookup } from '@internal/framework-components/codec';
import { createDataTypeLookup } from '@internal/framework-components/codec';
import { assembleAuthoringContributions } from '@internal/framework-components/control';
import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import { postgresDataTypes } from '@internal/target-postgres/data-types';
import { describe, expect, it } from 'vitest';
import {
  postgresAuthoringEntityTypes,
  postgresAuthoringPslBlockDescriptors,
} from '../src/core/authoring';
import { PostgresNativeEnum } from '../src/core/postgres-native-enum';
import { type PostgresSchema, postgresCreateNamespace } from '../src/core/postgres-schema';

const postgresDataTypeLookup = createDataTypeLookup(postgresDataTypes);

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

describe('native_enum coexists with a PSL enum block in the same namespace', () => {
  // PSL `enum` blocks are document-top-level only and always register under
  // the target's `defaultNamespaceId` (`public` here) — so a `native_enum`
  // block in `namespace public { … }` derives its valueSet into the same
  // namespace's valueSet slot as the top-level `enum`'s derived valueSet.
  // `createNamespaceWithExtensions` must merge both, not let one clobber
  // the other.
  const combinedAssembled = assembleAuthoringContributions([
    { authoring: sqlFamilyPack.authoring },
    {
      authoring: {
        entityTypes: postgresAuthoringEntityTypes,
        pslBlockDescriptors: postgresAuthoringPslBlockDescriptors,
      },
    },
  ]);

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

  const enumTestCodecLookup: CodecLookup = {
    get: (id) => (id === 'pg/text@1' ? textCodec : undefined),
    targetTypesFor: (id) => (id === 'pg/text@1' ? ['text'] : undefined),
    renderOutputTypeFor: () => undefined,
  };

  function interpretCombined(source: string) {
    const { document, sources } = parse(source, 'psl-native-enum-authoring.test.psl');
    const { symbolTable } = buildSymbolTable({
      documents: [document],
      sources,
      pslBlockDescriptors: combinedAssembled.pslBlockDescriptors,
    });
    return interpretPslDocumentToSqlContract({
      dataTypeLookup: postgresDataTypeLookup,
      document,
      symbolTable,
      sources,
      capabilities: {},
      target: postgresTarget,
      scalarColumnDescriptors,
      authoringContributions: combinedAssembled,
      composedExtensionContracts: new Map(),
      createNamespace: postgresCreateNamespace,
      codecLookup: enumTestCodecLookup,
    });
  }

  it('both the enum-derived and native_enum-derived valueSets survive in the public namespace', () => {
    const source = `
enum Priority {
  @@type("pg/text@1")
  Low  = "low"
  High = "high"
}

namespace public {
  native_enum AalLevel {
    aal1 = "aal1"
    aal2 = "aal2"
    @@map("aal_level")
  }

  model Post {
    id       Int      @id
    priority Priority
  }
}
`;
    const result = interpretCombined(source);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ns = result.value.storage.namespaces['public'] as PostgresSchema;
    expect(ns.valueSet?.['Priority']).toMatchObject({ values: ['low', 'high'] });
    expect(ns.valueSet?.['AalLevel']).toMatchObject({ values: ['aal1', 'aal2'] });
    expect(ns.entries.native_enum?.['aal_level']).toBeInstanceOf(PostgresNativeEnum);
  });

  it('a native_enum and a domain enum sharing a name in one namespace is rejected, not silently merged', () => {
    // Domain `enum` registers under the default namespace (`public`), and a
    // `native_enum` named the same in `namespace public { … }` derives a
    // value-set into the same slot. This must be a diagnostic, not a silent
    // last-write-wins.
    const source = `
enum Shared {
  @@type("pg/text@1")
  Low  = "low"
  High = "high"
}

namespace public {
  native_enum Shared {
    a = "a"
    b = "b"
    @@map("shared")
  }

  model Post {
    id Int @id
  }
}
`;
    const result = interpretCombined(source);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'PSL_VALUE_SET_NAME_COLLISION' })]),
    );
  });
});
