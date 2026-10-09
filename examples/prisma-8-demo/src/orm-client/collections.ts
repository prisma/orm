import { Collection } from '@prisma/orm-postgres/orm-client';
import type { Contract } from '../prisma/contract.d';

export class UserCollection extends Collection<Contract, 'User'> {
  admins() {
    return this.where({ kind: 'admin' });
  }

  byEmail(email: string) {
    return this.where({ email });
  }

  emailDomain(domain: string) {
    return this.where((user) => user.email.ilike(`%@${domain}`));
  }

  withPostTitle(titleTerm: string) {
    return this.where((user) => user.posts.some((post) => post.title.ilike(`%${titleTerm}%`)));
  }

  newestFirst() {
    return this.orderBy((user) => user.createdAt.desc());
  }
}

export class PostCollection extends Collection<Contract, 'Post'> {
  forUser(userId: string) {
    return this.where({ userId });
  }

  withTitle(titleTerm: string) {
    return this.where((post) => post.title.ilike(`%${titleTerm}%`));
  }

  newestFirst() {
    return this.orderBy((post) => post.createdAt.desc());
  }
}

export class TagCollection extends Collection<Contract, 'Tag'> {
  byLabel(label: string) {
    return this.where({ label });
  }
}

export class TaskCollection extends Collection<Contract, 'Task'> {
  bugs() {
    return this.variant('bug');
  }

  features() {
    return this.variant('feature');
  }

  forUser(userId: string) {
    return this.where({ userId });
  }
}
