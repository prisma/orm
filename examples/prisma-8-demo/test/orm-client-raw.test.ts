import type { Runtime } from '@prisma/orm-postgres/family-runtime';
import { describe, expect, it } from 'vitest';
import { createOrmClient } from '../src/orm-client/client';

describe('the demo ORM client', () => {
  it('binds a bare value interpolated into fns.raw', () => {
    const db = createOrmClient({} as Runtime);

    expect(() =>
      db.Post.where((p, { fns }) =>
        fns.eq(p.title, fns.raw`${'Zebra post note'}`.returns('pg/text@1')),
      ),
    ).not.toThrow();
  });
});
