import sqlFamilyDescriptor from '@internal/family-sql/control';
import type { ControlExtensionDescriptor } from '@internal/framework-components/control';
import { createControlStack } from '@internal/framework-components/control';
import postgresTargetControlDescriptor from '@internal/target-postgres/control';
import { describe, expect, it } from 'vitest';
import postgresAdapterControlDescriptor from '../src/exports/control';

function stackWithAlias(output: Record<string, unknown>) {
  const extension = {
    kind: 'extension',
    id: 'short-ids',
    version: '0.0.1',
    familyId: 'sql',
    targetId: 'postgres',
    authoring: { type: { ids: { Short: { kind: 'typeAlias', output } } } },
    create: () => ({ familyId: 'sql', targetId: 'postgres' }),
  } as unknown as ControlExtensionDescriptor<'sql', 'postgres'>;
  return createControlStack({
    family: sqlFamilyDescriptor,
    target: postgresTargetControlDescriptor,
    adapter: postgresAdapterControlDescriptor,
    extensions: [extension],
  });
}

describe('a Postgres stack with a contributed type alias', () => {
  it('assembles an alias whose generator fits its column', () => {
    const output = {
      type: { codecId: 'sql/varchar@1', typeParams: { length: 36 } },
      onCreate: { name: 'uuid', args: {} },
    };
    expect(stackWithAlias(output).authoringContributions.type).toMatchObject({
      ids: { Short: { kind: 'typeAlias', output } },
    });
  });

  it('refuses at assembly an alias whose generator does not fit the length of its column', () => {
    expect(() =>
      stackWithAlias({
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

  it('refuses at assembly an alias whose fixed type params its codec refuses', () => {
    expect(() =>
      stackWithAlias({ type: { codecId: 'sql/varchar@1', typeParams: { length: 0 } } }),
    ).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.PACK_CONTRIBUTION_INVALID',
        message: expect.stringMatching(
          /^Type alias "ids\.Short" fixes type parameters its codec "sql\/varchar@1" refuses: /,
        ),
      }),
    );
  });
});
