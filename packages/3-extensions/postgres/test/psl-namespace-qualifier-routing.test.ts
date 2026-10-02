import type { AuthoringTypeConstructorDescriptor } from '@internal/framework-components/authoring';
import { createDataTypeLookup, emptyCodecLookup } from '@internal/framework-components/codec';
import type { TargetPackRef } from '@internal/framework-components/components';
import { assembleAuthoringContributions } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { withSeedDiagnostics } from '@internal/psl-parser/interpret';
import { bindPslSchema } from '@internal/psl-parser/test';
import type { SqlStorage } from '@internal/sql-contract/types';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import {
  describeUnsupportedSqlAttribute,
  sqlAttributeSpecs,
} from '@internal/sql-contract-psl/attribute-specs';
import { sqlContextInput } from '@internal/sql-contract-psl/test';
import { postgresDataTypes } from '@internal/target-postgres/data-types';
import {
  PostgresSchema,
  PostgresUnboundSchema,
  postgresCreateNamespace,
} from '@internal/target-postgres/types';
import { describe, expect, it } from 'vitest';

const postgresDataTypeLookup = createDataTypeLookup(postgresDataTypes);

const postgresTargetPackRef: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
};

const postgresScalarTypeDescriptors = new Map([
  ['Int', { codecId: 'pg/int4@1', nativeType: 'int4' }],
] as const);

const scalarTypeConstructors: Record<string, AuthoringTypeConstructorDescriptor> =
  Object.fromEntries(
    [...postgresScalarTypeDescriptors].map(([name, output]) => [
      name,
      { kind: 'typeConstructor' as const, output },
    ]),
  );

const emptyAuthoringContributions = assembleAuthoringContributions([]);

function emit(schema: string) {
  const bound = bindPslSchema(schema, {
    sourceId: 'psl-namespace-qualifier-routing.test.psl',
    context: {
      composedExtensions: [],
      composedExtensionContracts: new Map(),
      authoringContributions: {
        ...emptyAuthoringContributions,
        type: { ...scalarTypeConstructors, ...emptyAuthoringContributions.type },
        attributeSpecs: sqlAttributeSpecs,
      },
      pslDiagnostics: { describeUnsupportedAttribute: describeUnsupportedSqlAttribute },
      codecLookup: { ...emptyCodecLookup, descriptorFor: () => undefined },
      controlMutationDefaults: { defaultFunctionRegistry: new Map(), generatorDescriptors: [] },
      dataTypes: { entries: {}, lookup: postgresDataTypeLookup },
      resolvedInputs: [],
      capabilities: { sql: { scalarList: true } },
    },
  });
  return withSeedDiagnostics(
    interpretPslDocumentToSqlContract({
      documents: bound.documents,
      sources: bound.sources,
      symbolTable: bound.symbolTable,
      binder: bound.binder,
      ...sqlContextInput(bound.context),
      target: postgresTargetPackRef,
      createNamespace: postgresCreateNamespace,
    }),
    bound.seedDiagnostics,
  );
}

/**
 * End-to-end demonstration that the FR15 slice-3 + FR16a wiring lines
 * up: a PSL document goes through the SQL PSL interpreter; the
 * Postgres `createNamespace` factory threads target-specific
 * `Namespace` concretions into `SqlStorage.namespaces`; and looking up
 * a model's `namespaceId` in that map yields the right qualifier
 * behaviour for DDL emission (`PostgresUnboundSchema` elides;
 * `PostgresSchema(id)` qualifies).
 *
 * Renders the namespace abstraction the planned AC6 PGlite integration
 * test relies on. The planner-side rewire (replacing
 * `qualifyTableName(ctx.schemaName, X)` with
 * `namespace.qualifyTable(X)` across ~28 DDL/check call sites in
 * `core/migrations/`) is the natural slice for a follow-on round; this
 * round closes the contract-side substrate so the planner refactor
 * has stable pre-resolved namespaces to consume.
 */
describe('PSL → SqlStorage.namespaces qualifier routing (FR15 slice 3 + FR16a end-to-end)', () => {
  // The qualifier hook is active: `createNamespace` now produces
  // target-specific concretions (PostgresUnboundSchema / PostgresSchema)
  // that carry the assembled tables and dispatch qualifyTable correctly.
  it('`namespace unbound { … }` lowers to PostgresUnboundSchema, whose qualifyTable elides the schema prefix', () => {
    const result = emit(`namespace unbound {
  model Tenant {
    id Int @id
  }
}
`);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const storage = result.value.storage as SqlStorage;
    expect(storage.namespaces[UNBOUND_NAMESPACE_ID]!.entries.table?.['Tenant']).toBeDefined();

    // The storage map carries the Postgres target concretion (not the
    // SQL family placeholder) at the unbound slot.
    const namespace = storage.namespaces[UNBOUND_NAMESPACE_ID];
    expect(namespace).toBeInstanceOf(PostgresUnboundSchema);

    // The qualifier elides — DDL emission against this namespace
    // produces unqualified output that `search_path` resolves at
    // runtime.
    if (!(namespace instanceof PostgresSchema)) {
      throw new Error('expected PostgresSchema concretion');
    }
    expect(namespace.qualifyTable('Tenant')).toBe('"Tenant"');
  });

  it('`namespace auth { … }` lowers to PostgresSchema("auth"), whose qualifyTable emits `"auth"."<table>"`', () => {
    const result = emit(`namespace auth {
  model User {
    id Int @id
  }
}
`);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const storage = result.value.storage as SqlStorage;
    expect(storage.namespaces['auth']!.entries.table?.['User']).toBeDefined();

    const namespace = storage.namespaces['auth'];
    expect(namespace).toBeInstanceOf(PostgresSchema);
    expect(namespace).not.toBeInstanceOf(PostgresUnboundSchema);
    if (!(namespace instanceof PostgresSchema)) {
      throw new Error('expected PostgresSchema concretion');
    }
    expect(namespace.qualifyTable('User')).toBe('"auth"."User"');
  });

  it('top-level (implicit) models lower to the public namespace with schema-qualified DDL', () => {
    const result = emit(`model Post {
  id Int @id
}
`);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const storage = result.value.storage as SqlStorage;
    expect(storage.namespaces['public']!.entries.table?.['Post']).toBeDefined();

    const namespace = storage.namespaces['public'];
    expect(namespace).toBeInstanceOf(PostgresSchema);
    expect(namespace).not.toBeInstanceOf(PostgresUnboundSchema);
    if (!(namespace instanceof PostgresSchema)) {
      throw new Error('expected PostgresSchema concretion');
    }
    expect(namespace.qualifyTable('Post')).toBe('"public"."Post"');
  });
});
