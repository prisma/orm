import type { DefaultModelRow } from '@prisma/orm-postgres/orm-client';
import { blindCast } from '@prisma/orm-postgres/utils/casts';
import type { Contract } from '../prisma/contract.d';
import type { DemoOrm } from '../prisma/db';

type PostId = DefaultModelRow<Contract, 'Post'>['id'];

/**
 * Many-to-many include example: fetch a post along with its tags via the
 * Post.tags N:M relation. Demonstrates `.include('tags', ...)` traversing
 * the junction table transparently.
 */
export async function ormClientGetPostTags(postId: string, orm: DemoOrm) {
  return orm.Post.select('id', 'title')
    .include('tags', (tag) => tag.select('id', 'label').orderBy((t) => t.label.asc()))
    .where({ id: toPostId(postId) })
    .first();
}

function toPostId(value: string): PostId {
  return blindCast<
    PostId,
    'demo CLI supplies ids as plain strings; the contract brands Post.id as a Char<36> uuid'
  >(value);
}
