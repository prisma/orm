import { describe, expect, it } from 'vitest';
import { db } from '../src/prisma/db';

describe('the demo ORM client', () => {
  it('binds a bare value interpolated into fns.raw', () => {
    expect(() =>
      db.orm.public.Post.where((p, { fns }) =>
        fns.eq(p.title, fns.raw`${'Zebra post note'}`.returns('pg/text@1')),
      ),
    ).not.toThrow();
  });
});
