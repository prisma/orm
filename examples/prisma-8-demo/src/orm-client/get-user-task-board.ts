import type { Runtime } from '@prisma/orm-postgres/family-runtime';
import { createOrmClient } from './client';

/**
 * Team task board: every user alongside their `tasks`, included in one read.
 *
 * `User.tasks` points at the `Task` polymorphic base (`@@discriminator(type)`),
 * so this is a polymorphic-target include. The include takes the default
 * projection — no `select(...)` — so each row comes back in its full default
 * shape: the shared `Task` columns plus the columns of whichever variant the
 * discriminator selects. `Bug` rows carry `severity` / `stepsToRepro`, `Feature`
 * rows carry `priority` / `targetRelease`, all decoded from the joined variant
 * tables (`bug`, `feature`) in a single read.
 */
export async function ormClientGetUserTaskBoard(limit: number, runtime: Runtime) {
  const db = createOrmClient(runtime);
  return db.User.newestFirst()
    .select('id', 'displayName', 'kind')
    .include('tasks', (tasks) => tasks.orderBy((task) => task.createdAt.asc()))
    .limit(limit)
    .all();
}
