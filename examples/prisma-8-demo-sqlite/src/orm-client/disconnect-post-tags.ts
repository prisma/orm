import type { DefaultModelRow } from '@prisma/orm-sqlite/orm-client';
import { castAs } from '@prisma/orm-sqlite/utils/casts';
import type { Contract } from '../prisma/contract.d';
import { db } from '../prisma/db';

type PostId = DefaultModelRow<Contract, 'Post'>['id'];
type TagId = DefaultModelRow<Contract, 'Tag'>['id'];

/**
 * Many-to-many disconnect example: unlink tags from a post by deleting the
 * corresponding junction rows. Returns the post with its remaining tags.
 */
export async function ormClientDisconnectPostTags(postId: string, tagIds: readonly string[]) {
  return db.orm.Post.where({ id: castAs<PostId>(postId) })
    .include('tags', (tag) => tag.select('id', 'label').orderBy((t) => t.label.asc()))
    .update({
      tags: (t) => t.disconnect(tagIds.map((id) => ({ id: castAs<TagId>(id) }))),
    });
}
