import { describe, expect, it } from 'vitest';
import {
  buildControlTableBootstrapQueries,
  buildSignMarkerBootstrapQueries,
} from '../src/contract-free/control-bootstrap';
import { MysqlCreateTable } from '../src/core/ddl/nodes';
import { mysqlTargetDescriptorMeta } from '../src/core/descriptor-meta';
import mysqlControlTarget from '../src/core/migrations/control-target';
import { escapeLiteral, quoteIdentifier, quoteLiteral } from '../src/core/sql-utils';
import mysqlRuntimeTarget from '../src/exports/runtime';

describe('the MySQL target descriptor', () => {
  it('reports no namespaces and the unbound default namespace', () => {
    expect({
      targetId: mysqlTargetDescriptorMeta.targetId,
      defaultNamespaceId: mysqlTargetDescriptorMeta.defaultNamespaceId,
      supportsNamespaces: mysqlTargetDescriptorMeta.supportsNamespaces,
      displayName: mysqlTargetDescriptorMeta.displayName,
    }).toEqual({
      targetId: 'mysql',
      defaultNamespaceId: '__unbound__',
      supportsNamespaces: false,
      displayName: 'MySQL',
    });
  });

  it('declares, on the control and runtime target, that every session runs in UTC, which its datetime codec reads, as Postgres declares DateStyle', () => {
    expect([mysqlTargetDescriptorMeta.sessionSettings, mysqlRuntimeTarget.sessionSettings]).toEqual(
      [{ time_zone: '+00:00' }, { time_zone: '+00:00' }],
    );
  });

  it('maps String to varchar(191) and DateTime to datetime(3)', () => {
    const types = mysqlTargetDescriptorMeta.authoring.type;
    expect([types.String.output, types.DateTime.output, types.Int.output]).toEqual([
      { codecId: 'sql/varchar@1', typeParams: { length: 191 } },
      { codecId: 'mysql/datetime@1', typeParams: { precision: 3 } },
      { codecId: 'mysql/int@1' },
    ]);
  });

  it('refuses a contract that is not a SQL contract', () => {
    expect(() =>
      mysqlControlTarget.migrations.contractToSchema({ storage: {} } as never, []),
    ).toThrow(expect.objectContaining({ code: 'CONTRACT.TARGET_MISMATCH' }));
  });

  it('projects no contract to an empty schema', () => {
    expect(mysqlControlTarget.migrations.contractToSchema(null, [])).toEqual(
      expect.objectContaining({ tables: {} }),
    );
  });

  it('creates a control target instance for the family', () => {
    expect(mysqlControlTarget.create()).toEqual({ familyId: 'sql', targetId: 'mysql' });
  });
});

describe('control tables', () => {
  it('creates the marker table for db sign, and the marker and ledger tables for the runner', () => {
    const tables = (nodes: readonly unknown[]) =>
      nodes.map((node) => (node instanceof MysqlCreateTable ? node.table : undefined));
    expect(tables(buildSignMarkerBootstrapQueries())).toEqual(['_prisma_marker']);
    expect(tables(buildControlTableBootstrapQueries())).toEqual([
      '_prisma_marker',
      '_prisma_ledger',
    ]);
  });
});

describe('MySQL quoting', () => {
  it('quotes identifiers with backticks and literals with single quotes', () => {
    expect([quoteIdentifier('a`b'), quoteLiteral("it's"), escapeLiteral('a\\b')]).toEqual([
      '`a``b`',
      "'it''s'",
      'a\\\\b',
    ]);
  });

  it('refuses an empty identifier and null bytes', () => {
    expect(() => quoteIdentifier('')).toThrow(/cannot be empty/);
    expect(() => quoteIdentifier('a\0')).toThrow(/null bytes/);
    expect(() => escapeLiteral('a\0')).toThrow(/null bytes/);
  });
});
