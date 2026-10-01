import { describe, expectTypeOf, it } from 'vitest';
import type { ConsumedHint } from '../src/control/control-migration-types';

const coordinate = { namespaceId: 'public', entityKind: 'table', entityName: 'Member' };

describe('ConsumedHint', () => {
  it('requires the old name on a rename', () => {
    // @ts-expect-error a rename carries the name it renamed from
    const rename: ConsumedHint = { kind: 'renamed', coordinate };
    expectTypeOf(rename).toEqualTypeOf<ConsumedHint>();
  });

  it('carries no old name on a deletion', () => {
    // @ts-expect-error a deletion has no old name
    const deletion: ConsumedHint = { kind: 'deleted', coordinate, from: 'Profile' };
    expectTypeOf(deletion).toEqualTypeOf<ConsumedHint>();
  });

  it('narrows to a string old name on a rename', () => {
    const hint = { kind: 'renamed', coordinate, from: 'Profile' } as ConsumedHint;
    if (hint.kind === 'renamed') {
      expectTypeOf(hint.from).toEqualTypeOf<string>();
    }
  });
});
