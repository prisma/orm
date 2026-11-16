import { describe, expect, it } from 'vitest';
import type { NodeId, StorageRow } from '../../src/statement-graph/edge';
import { NestJoin } from '../../src/statement-graph/nest-join';
import { WholeRows } from '../../src/statement-graph/whole-rows';
import { recordingRun } from './statements';

const posts = { name: 'posts', parentKey: ['id'], childKey: ['__prisma_parent_key_0'] };
const profile = { name: 'profile', parentKey: ['id'], childKey: ['__prisma_parent_key_0'] };

async function joined(
  nest: NestJoin,
  left: readonly StorageRow[],
  children: readonly (readonly StorageRow[])[] | null,
): Promise<unknown> {
  return nest.execute({ left, children }, recordingRun());
}

describe('NestJoin', () => {
  it('attaches to each parent the child rows whose parent key is its identity, in child order', async () => {
    const parents = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const children = [
      { __prisma_parent_key_0: 2, title: 'b1' },
      { __prisma_parent_key_0: 1, title: 'a1' },
      { __prisma_parent_key_0: 2, title: 'b2' },
    ];

    expect(await joined(new NestJoin([posts]), parents, [children])).toEqual([
      { id: 1, posts: [{ __prisma_parent_key_0: 1, title: 'a1' }] },
      {
        id: 2,
        posts: [
          { __prisma_parent_key_0: 2, title: 'b1' },
          { __prisma_parent_key_0: 2, title: 'b2' },
        ],
      },
      { id: 3, posts: [] },
    ]);
  });

  it('attaches the rows of each include under its own name', async () => {
    const parents = [{ id: 1 }];

    expect(
      await joined(new NestJoin([posts, profile]), parents, [
        [{ __prisma_parent_key_0: 1, title: 'a' }],
        [{ __prisma_parent_key_0: 1, bio: 'b' }],
      ]),
    ).toEqual([
      {
        id: 1,
        posts: [{ __prisma_parent_key_0: 1, title: 'a' }],
        profile: [{ __prisma_parent_key_0: 1, bio: 'b' }],
      },
    ]);
  });

  it('matches a composite identity on every part', async () => {
    const composite = {
      name: 'members',
      parentKey: ['tenant', 'id'],
      childKey: ['__prisma_parent_key_0', '__prisma_parent_key_1'],
    };
    const parents = [
      { tenant: 'a', id: 1 },
      { tenant: 'b', id: 1 },
    ];
    const children = [{ __prisma_parent_key_0: 'b', __prisma_parent_key_1: 1, name: 'x' }];

    expect(await joined(new NestJoin([composite]), parents, [children])).toEqual([
      { tenant: 'a', id: 1, members: [] },
      { tenant: 'b', id: 1, members: children },
    ]);
  });

  it('matches keys that decode to equal values but are different objects', async () => {
    const parents = [{ id: 10n }];
    const children = [{ __prisma_parent_key_0: 10n, title: 'a' }];

    expect(await joined(new NestJoin([posts]), parents, [children])).toEqual([
      { id: 10n, posts: children },
    ]);
  });

  it('gives no rows for no parents', async () => {
    expect(await joined(new NestJoin([posts]), [], [[{ __prisma_parent_key_0: 1 }]])).toEqual([]);
  });
});

describe('WholeRows', () => {
  it('passes the source row whole, with the lists a NestJoin attached', () => {
    const row = { id: 1, posts: [{ id: 2 }] };
    expect(new WholeRows(0 as NodeId).output(row)).toBe(row);
  });
});
