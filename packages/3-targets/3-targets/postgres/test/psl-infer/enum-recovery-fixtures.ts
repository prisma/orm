/**
 * Shared fixtures for the Path A domain-enum recovery tests: schema-IR tree
 * builders, wire-named membership/element checks computed with the real
 * naming helpers (never hand-spelled hashes), and the print entry with the
 * family `enum` descriptor merged in.
 */
import sqlFamilyPack from '@internal/family-sql/pack';
import { printPsl } from '@internal/psl-printer';
import { composeCheckWirePrefix, computeCheckContentHash } from '@internal/sql-schema-ir/naming';
import type { SqlCheckConstraintIRInput, SqlColumnIRInput } from '@internal/sql-schema-ir/types';
import { assert } from 'vitest';
import { postgresAuthoringPslBlockDescriptors } from '../../src/core/authoring';
import { postgresRenderCheckExpressions } from '../../src/core/check-expressions';
import { inferPostgresPslContract } from '../../src/core/psl-infer/infer-psl-contract';
import { PostgresDatabaseSchemaNode } from '../../src/core/schema-ir/postgres-database-schema-node';
import { PostgresNamespaceSchemaNode } from '../../src/core/schema-ir/postgres-namespace-schema-node';
import { PostgresNativeEnumSchemaNode } from '../../src/core/schema-ir/postgres-native-enum-schema-node';
import { PostgresTableSchemaNode } from '../../src/core/schema-ir/postgres-table-schema-node';

export function table(
  name: string,
  columns: Record<string, SqlColumnIRInput>,
  checks: readonly SqlCheckConstraintIRInput[] = [],
) {
  return new PostgresTableSchemaNode({
    name,
    columns,
    primaryKey: { columns: ['id'] },
    foreignKeys: [],
    uniques: [],
    indexes: [],
    checks,
    policies: [],
    rlsEnabled: false,
  });
}

export function namespaceNode(
  schemaName: string,
  tables: Record<string, PostgresTableSchemaNode>,
  nativeEnums: readonly { typeName: string; values: readonly string[] }[] = [],
) {
  return new PostgresNamespaceSchemaNode({
    schemaName,
    tables,
    nativeEnums: nativeEnums.map(
      (entry) =>
        new PostgresNativeEnumSchemaNode({
          typeName: entry.typeName,
          namespaceId: schemaName,
          members: entry.values,
        }),
    ),
  });
}

export function tree(namespaces: Record<string, PostgresNamespaceSchemaNode>) {
  return new PostgresDatabaseSchemaNode({
    namespaces,
    roles: [],
    existingSchemas: Object.keys(namespaces),
    pgVersion: '',
  });
}

export const idColumn: SqlColumnIRInput = { name: 'id', nativeType: 'int4', nullable: false };

/**
 * The wire name the toolchain gave the membership check it derived for this
 * column and member list — the authored render is hashed, never the reprint.
 */
export function membershipWireName(
  tableName: string,
  columnName: string,
  many: boolean,
  memberValues: readonly string[],
): { prefix: string; hash: string } {
  const candidate = postgresRenderCheckExpressions({
    tableName,
    columnName,
    many,
    memberValues,
  }).find((c) => c.kind === 'membership');
  assert.ok(candidate, 'membership candidate must render for a non-empty member list');
  return {
    prefix: composeCheckWirePrefix(tableName, columnName, 'membership'),
    hash: computeCheckContentHash(candidate.expression),
  };
}

/** A live membership check: wire name from the real helpers, body a reprint. */
export function membershipCheck(
  tableName: string,
  columnName: string,
  many: boolean,
  memberValues: readonly string[],
  reprint: string,
): SqlCheckConstraintIRInput {
  const { prefix, hash } = membershipWireName(tableName, columnName, many, memberValues);
  return { naming: { kind: 'wire', prefix, hash }, expression: reprint, dependsOn: undefined };
}

export function elementNotNullCheck(
  tableName: string,
  columnName: string,
): SqlCheckConstraintIRInput {
  const candidate = postgresRenderCheckExpressions({
    tableName,
    columnName,
    many: true,
    memberValues: undefined,
  }).find((c) => c.kind === 'elementNotNull');
  assert.ok(candidate, 'elementNotNull candidate must render for a list column');
  return {
    naming: {
      kind: 'wire',
      prefix: composeCheckWirePrefix(tableName, columnName, 'elementNotNull'),
      hash: computeCheckContentHash(candidate.expression),
    },
    expression: `(array_position(${columnName}, NULL) IS NULL)`,
    dependsOn: undefined,
  };
}

// The print sites must know the family `enum` block descriptor — the
// target-only set has no descriptor for the keyword.
export const printDescriptors = {
  ...sqlFamilyPack.authoring.pslBlockDescriptors,
  ...postgresAuthoringPslBlockDescriptors,
};

export function inferAndPrint(dbTree: PostgresDatabaseSchemaNode): string {
  return printPsl(inferPostgresPslContract(dbTree), { pslBlockDescriptors: printDescriptors });
}
