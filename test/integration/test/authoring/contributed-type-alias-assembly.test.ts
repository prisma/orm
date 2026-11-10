import type { ExtensionPackRef } from '@internal/framework-components/components';
import { defineContract } from '@internal/postgres/contract-builder';
import { describe, expect, it } from 'vitest';

function contractWithAlias(output: Record<string, unknown>) {
  const shortIds = {
    kind: 'extension',
    id: 'short-ids',
    version: '0.0.1',
    familyId: 'sql',
    targetId: 'postgres',
    authoring: { type: { ids: { Short: { kind: 'typeAlias', output } } } },
  } as unknown as ExtensionPackRef<'sql', 'postgres'>;
  return () => defineContract({ extensions: { shortIds }, models: {} });
}

describe('a Postgres TypeScript contract whose extension contributes a type alias', () => {
  it('builds when the generator fits the column', () => {
    expect(
      contractWithAlias({
        type: { codecId: 'sql/varchar@1', typeParams: { length: 36 } },
        onCreate: { name: 'uuid', args: {} },
      }),
    ).not.toThrow();
  });

  it('is refused when the generator does not fit the length of the column', () => {
    expect(
      contractWithAlias({
        type: { codecId: 'sql/varchar@1', typeParams: { length: 8 } },
        onCreate: { name: 'uuid', args: {} },
      }),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.PACK_CONTRIBUTION_INVALID',
        message:
          'Type alias "ids.Short" calls uuid() on create, which its codec "sql/varchar@1" refuses: uuid() writes 36 characters, which does not fit a column of 8 characters.',
      }),
    );
  });

  it('is refused when its codec refuses the fixed type params', () => {
    expect(
      contractWithAlias({ type: { codecId: 'sql/varchar@1', typeParams: { length: 0 } } }),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.PACK_CONTRIBUTION_INVALID',
        message:
          'Type alias "ids.Short" fixes type parameters its codec "sql/varchar@1" refuses: length must be at least 1 (was 0)',
      }),
    );
  });
});
