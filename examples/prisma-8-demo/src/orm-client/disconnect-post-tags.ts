import type { DefaultModelRow } from '@prisma/orm-postgres/orm-client';
import { blindCast } from '@prisma/orm-postgres/utils/casts';
import type { Contract } from '../prisma/contract.d';
import type { DemoOrm } from '../prisma/db';

type PostId = DefaultModelRow<Contract, 'Post'>['id'];
type TagId = DefaultModelRow<Contract, 'Tag'>['id'];

/**
 * Many-to-many disconnect example: unlink tags from a post by deleting the
 * corresponding junction rows. Returns the post with its remaining tags.
 */
export async function ormClientDisconnectPostTags(
  postId: string,
  tagIds: readonly string[],
  orm: DemoOrm,
) {
  return orm.Post.where({ id: toPostId(postId) })
    .select('id', 'title')
    .include('tags', (tag) => tag.select('id', 'label').orderBy((t) => t.label.asc()))
    .update({
      tags: (t) => t.disconnect(tagIds.map((id) => ({ id: toTagId(id) }))),
    });
}

function toPostId(value: string): PostId {
  return blindCast<
    PostId,
    'demo CLI supplies ids as plain strings; the contract brands Post.id as a Char<36> uuid'
  >(value);
}

function toTagId(value: string): TagId {
  return blindCast<
    TagId,
    'demo CLI supplies ids as plain strings; the contract brands Tag.id as a Char<36> uuid'
  >(value);
}
