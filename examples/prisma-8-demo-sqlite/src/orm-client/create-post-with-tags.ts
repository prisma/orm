import type { DefaultModelRow } from '@prisma/orm-sqlite/orm-client';
import { castAs } from '@prisma/orm-sqlite/utils/casts';
import type { Contract } from '../prisma/contract.d';
import { db } from '../prisma/db';

type PostRow = DefaultModelRow<Contract, 'Post'>;
type TagRow = DefaultModelRow<Contract, 'Tag'>;

export interface CreatePostWithTagsInput {
  readonly id: string;
  readonly title: string;
  readonly userId: string;
  readonly tags: ReadonlyArray<{ readonly label: string }>;
}

/**
 * Many-to-many nested create example: insert a new post and simultaneously
 * create + link new tags via the callback mutator. Demonstrates
 * `t.create([...])` on an N:M relation from inside a `create()` call.
 */
export async function ormClientCreatePostWithTags(input: CreatePostWithTagsInput) {
  return db.orm.Post.create({
    id: castAs<PostRow['id']>(input.id),
    title: input.title,
    userId: castAs<PostRow['userId']>(input.userId),
    tags: (t) =>
      t.create(
        input.tags.map((tag) => ({
          label: castAs<TagRow['label']>(tag.label),
        })),
      ),
  });
}
