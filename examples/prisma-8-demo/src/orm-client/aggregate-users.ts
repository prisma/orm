import type { DemoOrm } from '../prisma/db';

export async function ormClientAggregateUsers(orm: DemoOrm) {
  const totalUsers = await orm.User.aggregate((aggregate) => ({
    totalUsers: aggregate.count(),
  }));
  const adminUsers = await orm.User.where({ kind: 'admin' }).aggregate((aggregate) => ({
    adminUsers: aggregate.count(),
  }));

  return {
    ...totalUsers,
    ...adminUsers,
  };
}
