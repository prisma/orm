import type { DefaultModelRow } from '@prisma/orm-sqlite/orm-client';
import { castAs } from '@prisma/orm-sqlite/utils/casts';
import type { Contract } from '../prisma/contract.d';
import { db } from '../prisma/db';

type PostId = DefaultModelRow<Contract, 'Post'>['id'];
type TagId = DefaultModelRow<Contract, 'Tag'>['id'];

/**
 * Many-to-many connect example: link existing tags to a post via the
 * callback mutator. Inserts junction rows for each tag id supplied; does
 * not create new tags. Returns the post with its updated tag list included.
 */
export async function ormClientConnectPostTags(postId: string, tagIds: readonly string[]) {
  return db.orm.Post.where({ id: castAs<PostId>(postId) })
    .include('tags', (tag) => tag.select('id', 'label').orderBy((t) => t.label.asc()))
    .update({
      tags: (t) => t.connect(tagIds.map((id) => ({ id: castAs<TagId>(id) }))),
    });
}
