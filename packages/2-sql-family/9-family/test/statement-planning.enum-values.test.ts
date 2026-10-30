import { asNamespaceId } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import { planStatements } from '../src/core/migrations/statement-planning';
import { ALL_CLASSES, contractOf, fakeTarget, planned } from './statement-fixtures';

describe('an enum value rename', () => {
  it('plans no call among the renames: its rewrites are planned with the diff', () => {
    const app = asNamespaceId('app');
    const contract = contractOf({ User: { table: 'User', fields: { status: 'status' } } });

    expect(
      planned(
        planStatements({
          statements: [
            {
              kind: 'rename',
              entity: 'enumValue',
              from: { namespaceId: app, enum: 'Status', member: 'ARCHIVED' },
              to: { namespaceId: app, enum: 'Status', member: 'RETIRED' },
            },
          ],
          fromContract: contract,
          contract,
          policy: ALL_CLASSES,
          target: fakeTarget(['app.User']),
        }),
      ),
    ).toMatchObject({
      calls: [],
      plannedStatements: [{ operations: { kind: 'plannedWithDiff' } }],
    });
  });
});
