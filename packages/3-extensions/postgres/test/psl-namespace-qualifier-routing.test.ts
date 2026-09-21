import { createDataTypeLookup } from '@internal/framework-components/codec';
import type { TargetPackRef } from '@internal/framework-components/components';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import type { SqlStorage } from '@internal/sql-contract/types';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
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

function symbolTableInput(schema: string) {
  const { document, sources } = parse(schema, 'psl-namespace-qualifier-routing.test.psl');
  const { symbolTable } = buildSymbolTable({
    documents: [document],
    sources,
    pslBlockDescriptors: {},
  });
  return { document, sources, symbolTable };
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
    const document = symbolTableInput(`namespace unbound {
  model Tenant {
    id Int @id
  }
}
`);

    const result = interpretPslDocumentToSqlContract({
      dataTypeLookup: postgresDataTypeLookup,
      ...document,
      target: postgresTargetPackRef,
      scalarColumnDescriptors: postgresScalarTypeDescriptors,
      composedExtensionContracts: new Map(),
      createNamespace: postgresCreateNamespace,
      capabilities: { sql: { scalarList: true } },
    });
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
    const document = symbolTableInput(`namespace auth {
  model User {
    id Int @id
  }
}
`);

    const result = interpretPslDocumentToSqlContract({
      dataTypeLookup: postgresDataTypeLookup,
      ...document,
      target: postgresTargetPackRef,
      scalarColumnDescriptors: postgresScalarTypeDescriptors,
      composedExtensionContracts: new Map(),
      createNamespace: postgresCreateNamespace,
      capabilities: { sql: { scalarList: true } },
    });
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
    const document = symbolTableInput(`model Post {
  id Int @id
}
`);

    const result = interpretPslDocumentToSqlContract({
      dataTypeLookup: postgresDataTypeLookup,
      ...document,
      target: postgresTargetPackRef,
      scalarColumnDescriptors: postgresScalarTypeDescriptors,
      composedExtensionContracts: new Map(),
      createNamespace: postgresCreateNamespace,
      capabilities: { sql: { scalarList: true } },
    });
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
