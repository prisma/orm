import type { DefaultModelRow } from '@prisma/orm-postgres/orm-client';
import type { Contract } from '../prisma/contract.d';
import type { DemoOrm } from '../prisma/db';

type UserKind = DefaultModelRow<Contract, 'User'>['kind'];

export async function ormClientGetUserKindBreakdown(
  minUsers: number,
  orm: DemoOrm,
): Promise<Array<{ kind: UserKind; totalUsers: number }>> {
  const grouped = await orm.User.groupBy('kind')
    .having((having) => having.count().gte(minUsers))
    .aggregate((aggregate) => ({
      totalUsers: aggregate.count(),
    }));

  return [...grouped].sort((left, right) => left.kind.localeCompare(right.kind));
}
