import type { Contract } from '@internal/contract/types';
import type { CodecControlHooks } from '@internal/family-sql/control';
import type { TargetBoundComponentDescriptor } from '@internal/framework-components/components';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { sqliteContractToSchema } from '../../src/core/migrations/diff-database-schema';
import { createSqliteMigrationPlanner } from '../../src/core/migrations/planner';
import { contractOf, stubLowerer } from './rename-table-fixtures';

function recordingComponent(events: string[]) {
  const hook: CodecControlHooks = {
    onFieldEvent: (event, ctx) => {
      events.push(`${event} ${ctx.tableName}.${ctx.fieldName}`);
      return [];
    },
  };
  return {
    kind: 'extension',
    id: 'field-event-recorder',
    familyId: 'sql',
    targetId: 'sqlite',
    types: {
      codecTypes: { controlPlaneHooks: { 'sqlite/integer@1': hook, 'sqlite/text@1': hook } },
    },
  } as unknown as TargetBoundComponentDescriptor<'sql', string>;
}

const start = contractOf('Profile', {}, 'from');

function fieldEventsPlanning(destination: Contract<SqlStorage>): readonly string[] {
  const events: string[] = [];
  const result = createSqliteMigrationPlanner(stubLowerer).plan({
    contract: destination,
    schema: sqliteContractToSchema(start),
    policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
    fromContract: start,
    frameworkComponents: [recordingComponent(events)],
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
  });
  if (result.kind !== 'success') throw new Error(JSON.stringify(result.conflicts));
  return events;
}

describe('field events when a hint renames a table', () => {
  it('reports no field of a hinted table as dropped or added', () => {
    const hinted = {
      ...contractOf('Member', {}, 'b'.repeat(64)),
      hints: { namespaces: { [UNBOUND_NAMESPACE_ID]: { tables: { Member: { was: 'Profile' } } } } },
    };

    expect(fieldEventsPlanning(hinted)).toEqual([]);
  });

  it('still reports every field of an unhinted drop and create', () => {
    expect(fieldEventsPlanning(contractOf('Member', {}, 'b'.repeat(64)))).toEqual(
      expect.arrayContaining(['added Member.email', 'dropped Profile.email']),
    );
  });
});
