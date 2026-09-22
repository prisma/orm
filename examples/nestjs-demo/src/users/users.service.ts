import { Inject, Injectable } from '@nestjs/common';
import { DB, type Db } from '../prisma/prisma.module.js';

@Injectable()
export class UsersService {
  constructor(@Inject(DB) private readonly db: Db) {}

  findOne(id: number) {
    return this.db.orm.public.User.where({ id })
      .include('posts', (p) => p.select('id', 'title'))
      .first();
  }

  createWithWelcomePost(input: { email: string; name?: string }) {
    return this.db.transaction(async (tx) => {
      const user = await tx.orm.public.User.create(input);

      const post = await tx.orm.public.Post.create({
        authorId: user.id,
        title: `Welcome, ${user.name ?? user.email}!`,
      });

      return { user, post };
    });
  }
}
