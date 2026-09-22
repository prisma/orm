/**
 * CLI Application Entry Point (No-Emit Workflow)
 *
 * This is a command-line demo that showcases the "no-emit" workflow where the
 * contract is defined inline in TypeScript (prisma-no-emit/context.ts)
 * rather than emitted to separate JSON/d.ts files.
 *
 * This workflow is useful for:
 * - Rapid prototyping without a build step
 * - Simpler projects that don't need contract serialization
 * - Understanding the contract structure before committing to emission
 *
 * Run with: pnpm start:no-emit -- <command> [args]
 *
 * Available commands:
 * - users [limit]              List users with optional limit
 * - user <id>                  Get user by ID
 * - posts <userId>             Get posts for a user
 * - users-with-posts [limit]   Users with posts via ORM client (include)
 * - enum-default-demo          Insert a Post without `priority` (typed-optional thanks to
 *                              `.default(Priority.members.Low)` in the inline TS contract),
 *                              read it back, and confirm the database supplied 0 (Low)
 *
 * See also:
 * - main.ts: Full CLI using emitted contract.json + contract.d.ts
 */
import 'dotenv/config';
import { loadAppConfig } from './app-config';
import { getRuntime } from './prisma-no-emit/runtime';
import { enumDefaultDemoNoEmit } from './queries/enum-default-demo-no-emit';
import { getUserById } from './queries/get-user-by-id-no-emit';
import { getUserPosts } from './queries/get-user-posts-no-emit';
import { getUsers } from './queries/get-users-no-emit';
import { getUsersWithPosts } from './queries/get-users-with-posts-no-emit';

const argv = process.argv.slice(2).filter((arg) => arg !== '--');
const [cmd, ...args] = argv;

async function main() {
  const { databaseUrl } = loadAppConfig();
  const runtime = await getRuntime(databaseUrl);
  try {
    if (cmd === 'users') {
      const parsedLimit = args[0] ? Number.parseInt(args[0], 10) : 10;
      const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 10;
      const users = await getUsers(runtime, limit);
      console.log(JSON.stringify(users, null, 2));
    } else if (cmd === 'user') {
      const [userIdStr] = args;
      if (!userIdStr) {
        console.error('Usage: pnpm start:no-emit -- user <userId>');
        process.exit(1);
      }
      const user = await getUserById(userIdStr, runtime);
      console.log(JSON.stringify(user, null, 2));
    } else if (cmd === 'posts') {
      const [userIdStr] = args;
      if (!userIdStr) {
        console.error('Usage: pnpm start:no-emit -- posts <userId>');
        process.exit(1);
      }
      const posts = await getUserPosts(userIdStr, runtime);
      console.log(JSON.stringify(posts, null, 2));
    } else if (cmd === 'users-with-posts') {
      const parsedLimit = args[0] ? Number.parseInt(args[0], 10) : 10;
      const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 10;
      const usersWithPosts = await getUsersWithPosts(runtime, limit);
      console.log(JSON.stringify(usersWithPosts, null, 2));
    } else if (cmd === 'enum-default-demo') {
      console.log(
        'Demonstrating enum member default: inserting a Post without priority, then reading it back...',
      );
      await enumDefaultDemoNoEmit(runtime);
    } else {
      console.log(
        'Usage: pnpm start:no-emit -- [users [limit] | user <userId> | posts <userId> | ' +
          'users-with-posts [limit] | enum-default-demo]',
      );
      process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await runtime.close();
  }
}

await main();
