import type { ConsumedHint } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { describeConsumedHint } from '../src/core/migrations/hint-advice';

const onTable = (entityName: string) => ({
  namespaceId: UNBOUND_NAMESPACE_ID,
  entityKind: 'table',
  entityName,
});

describe('describeConsumedHint', () => {
  it('describes a table rename', () => {
    const hint: ConsumedHint = { kind: 'renamed', coordinate: onTable('User'), from: 'Person' };

    expect(describeConsumedHint(hint)).toBe(
      'rename hint on table "User" (was "Person"): renamed and recorded in this migration; you can remove the hint.',
    );
  });

  it('describes a column rename', () => {
    const hint: ConsumedHint = {
      kind: 'renamed',
      coordinate: onTable('User'),
      memberName: 'firstName',
      from: 'first_name',
    };

    expect(describeConsumedHint(hint)).toBe(
      'rename hint on column "User"."firstName" (was "first_name"): renamed and recorded; you can remove the hint.',
    );
  });

  it('describes a table deletion', () => {
    const hint: ConsumedHint = { kind: 'deleted', coordinate: onTable('Legacy') };

    expect(describeConsumedHint(hint)).toBe(
      'deleted hint on table "Legacy": dropped and recorded; you can remove the model.',
    );
  });

  it('describes a column deletion', () => {
    const hint: ConsumedHint = {
      kind: 'deleted',
      coordinate: onTable('User'),
      memberName: 'nickname',
    };

    expect(describeConsumedHint(hint)).toBe(
      'deleted hint on column "User"."nickname": dropped and recorded; you can remove the field.',
    );
  });
});
