/**
 * CLI demo for Prisma 8 on SQLite.
 *
 * Usage: `pnpm start -- <command> [args]`
 *
 * Commands:
 * - users [limit]                          List users via the SQL builder
 * - repo-user <id>                         Find a user by id via the ORM client
 * - repo-user-posts <id> [limit]           Fetch a user with their posts (relational include)
 * - repo-create-user <id> <email> <name>   Create a user via the ORM client
 * - insert-user <email> <name>             Insert a user via the SQL builder (INSERT … RETURNING)
 * - user-by-email-prepared <email> [<email> ...]
 *                                          Build a `PreparedStatement` once and reuse it for
 *                                          each email — single lower(), single beforeCompile(),
 *                                          repeated execute()
 * - add-posts <userId> <title> [...moreTitles]
 *                                          Add posts to an existing user atomically via
 *                                          db.transaction(). The transaction reads the current post
 *                                          count (SQL builder aggregate) and only inserts (ORM
 *                                          create) if the quota allows — otherwise throws
 *                                          QuotaExceededError and rolls back. Prints created posts
 *                                          on success; prints the rollback reason and the unchanged
 *                                          count on quota violation.
 * - integer-representations [limit]        The two Post engagement counters side by side:
 *                                          `BigIntNumber` reads as a JS number, `BigInt` as a
 *                                          bigint. SQLite offers no `UnboundedInt`.
 * - aggregate-precision                    count/sum/avg beside countBigInt/sumBigInt, including a
 *                                          bare sum() whose total passes 2^53 and raises rather
 *                                          than rounding. SQLite has no avgDecimal at all.
 *
 * Many-to-many commands (Post ↔ Tag via PostTag junction):
 * - post-tags <postId>                     Include a post's tags (N:M read)
 * - tag-posts <tagId>                      Include a tag's posts (N:M read, reverse direction)
 * - posts-with-tag-some <label>            Posts that have at least one tag matching label
 * - posts-with-tag-none <label>            Posts that have no tag matching label
 * - posts-with-tag-every <label>           Posts where every tag differs from label
 *                                          Includes posts with no tags
 * - connect-post-tags <postId> <tagId...>  Link existing tags to a post
 * - disconnect-post-tags <postId> <tagId...>  Unlink tags from a post
 * - create-post-with-tags <id> <userId> <title> <label...>
 *                                          Create post + new tags in one nested mutation
 * - create-post-connect-tags <id> <userId> <title> <tagId...>
 *                                          Create post + link existing tags in one nested mutation
 *
 * Each command opens a connection, runs the operation, prints the result as
 * JSON, and closes. Exits non-zero on usage errors or runtime failures.
 */
import 'dotenv/config';
import { loadAppConfig } from './app-config';
import { ormClientConnectPostTags } from './orm-client/connect-post-tags';
import { ormClientCreatePostConnectTags } from './orm-client/create-post-connect-tags';
import { ormClientCreatePostWithTags } from './orm-client/create-post-with-tags';
import { ormClientCreateUser } from './orm-client/create-user';
import { ormClientDisconnectPostTags } from './orm-client/disconnect-post-tags';
import { ormClientFindUserById } from './orm-client/find-user-by-id';
import { ormClientGetEngagementPrecision } from './orm-client/get-engagement-precision';
import { ormClientGetPostEngagement } from './orm-client/get-post-engagement';
import { ormClientGetPostTags } from './orm-client/get-post-tags';
import { ormClientGetPostsByTagFilter } from './orm-client/get-posts-by-tag-filter';
import { ormClientGetTagPosts } from './orm-client/get-tag-posts';
import { ormClientGetUserPosts } from './orm-client/get-user-posts';
import { db } from './prisma/db';
import { insertUser } from './queries/dml-operations';
import { getUserByEmailPrepared } from './queries/get-user-by-email-prepared';
import { getUsers } from './queries/get-users';
import { addPostsWithinQuota, QuotaExceededError } from './transactions/add-posts-within-quota';

const argv = process.argv.slice(2).filter((arg) => arg !== '--');
const [cmd, ...args] = argv;

/**
 * Renders a value with the JavaScript type it arrived as. The
 * integer-representation demos are about exactly that, and `JSON.stringify`
 * cannot help: it refuses a `bigint` outright.
 */
function describe(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'bigint') return `${value}n (bigint)`;
  return `${String(value)} (${typeof value})`;
}

async function main() {
  const { databasePath } = loadAppConfig();
  const runtime = await db.connect({ path: databasePath });

  try {
    if (cmd === 'users') {
      const limit = args[0] ? Number.parseInt(args[0], 10) : 10;
      const users = await getUsers(limit);
      console.log(JSON.stringify(users, null, 2));
    } else if (cmd === 'repo-user') {
      const [id] = args;
      if (!id) {
        console.error('Usage: pnpm start -- repo-user <id>');
        process.exitCode = 1;
        return;
      }
      const user = await ormClientFindUserById(id, runtime);
      console.log(JSON.stringify(user, null, 2));
    } else if (cmd === 'repo-user-posts') {
      const [id, limitStr] = args;
      if (!id) {
        console.error('Usage: pnpm start -- repo-user-posts <id> [limit]');
        process.exitCode = 1;
        return;
      }
      const limit = limitStr ? Number.parseInt(limitStr, 10) : 10;
      const result = await ormClientGetUserPosts(id, limit, runtime);
      console.log(JSON.stringify(result, null, 2));
    } else if (cmd === 'repo-create-user') {
      const [id, email, displayName] = args;
      if (!id || !email || !displayName) {
        console.error('Usage: pnpm start -- repo-create-user <id> <email> <displayName>');
        process.exitCode = 1;
        return;
      }
      const user = await ormClientCreateUser(
        { id, email, displayName, createdAt: new Date() },
        runtime,
      );
      console.log(JSON.stringify(user, null, 2));
    } else if (cmd === 'insert-user') {
      const [email, displayName] = args;
      if (!email || !displayName) {
        console.error('Usage: pnpm start -- insert-user <email> <displayName>');
        process.exitCode = 1;
        return;
      }
      const user = await insertUser(email, displayName);
      console.log(JSON.stringify(user, null, 2));
    } else if (cmd === 'user-by-email-prepared') {
      if (args.length === 0) {
        console.error('Usage: pnpm start -- user-by-email-prepared <email> [<email> ...]');
        process.exitCode = 1;
        return;
      }
      const results = await getUserByEmailPrepared(args);
      console.log(JSON.stringify(results, null, 2));
    } else if (cmd === 'add-posts') {
      const [userId, ...titles] = args;
      if (!userId || titles.length === 0) {
        console.error('Usage: pnpm start -- add-posts <userId> <title> [...moreTitles]');
        process.exitCode = 1;
        return;
      }
      try {
        const result = await addPostsWithinQuota({ userId, titles });
        console.log(JSON.stringify(result, null, 2));
      } catch (txError) {
        if (txError instanceof QuotaExceededError) {
          console.error('Transaction rolled back:', txError.message);
          const countRows = await runtime.query(
            db.sql.post
              .select('postCount', (_f, fns) => fns.count())
              .where((f, fns) => fns.eq(f.userId, userId))
              .build(),
          );
          console.log('Post count after rollback:', countRows[0]?.postCount);
          process.exitCode = 1;
          return;
        }
        throw txError;
      }
    } else if (cmd === 'post-tags') {
      const [postId] = args;
      if (!postId) {
        console.error('Usage: pnpm start -- post-tags <postId>');
        process.exitCode = 1;
        return;
      }
      const result = await ormClientGetPostTags(postId, runtime);
      console.log(JSON.stringify(result, null, 2));
    } else if (cmd === 'tag-posts') {
      const [tagId] = args;
      if (!tagId) {
        console.error('Usage: pnpm start -- tag-posts <tagId>');
        process.exitCode = 1;
        return;
      }
      const result = await ormClientGetTagPosts(tagId, runtime);
      console.log(JSON.stringify(result, null, 2));
    } else if (
      cmd === 'posts-with-tag-some' ||
      cmd === 'posts-with-tag-none' ||
      cmd === 'posts-with-tag-every'
    ) {
      const [label] = args;
      if (!label) {
        console.error(`Usage: pnpm start -- ${cmd} <label>`);
        process.exitCode = 1;
        return;
      }
      const mode =
        cmd === 'posts-with-tag-some' ? 'some' : cmd === 'posts-with-tag-none' ? 'none' : 'every';
      const results = await ormClientGetPostsByTagFilter(mode, label, runtime);
      console.log(JSON.stringify(results, null, 2));
    } else if (cmd === 'connect-post-tags') {
      const [postId, ...tagIds] = args;
      if (!postId || tagIds.length === 0) {
        console.error('Usage: pnpm start -- connect-post-tags <postId> <tagId...>');
        process.exitCode = 1;
        return;
      }
      const result = await ormClientConnectPostTags(postId, tagIds, runtime);
      console.log(JSON.stringify(result, null, 2));
    } else if (cmd === 'disconnect-post-tags') {
      const [postId, ...tagIds] = args;
      if (!postId || tagIds.length === 0) {
        console.error('Usage: pnpm start -- disconnect-post-tags <postId> <tagId...>');
        process.exitCode = 1;
        return;
      }
      const result = await ormClientDisconnectPostTags(postId, tagIds, runtime);
      console.log(JSON.stringify(result, null, 2));
    } else if (cmd === 'create-post-with-tags') {
      const [id, userId, title, ...labels] = args;
      if (!id || !userId || !title || labels.length === 0) {
        console.error(
          'Usage: pnpm start -- create-post-with-tags <id> <userId> <title> <label...>',
        );
        process.exitCode = 1;
        return;
      }
      const result = await ormClientCreatePostWithTags(
        { id, userId, title, tags: labels.map((label) => ({ label })) },
        runtime,
      );
      console.log(JSON.stringify(result, null, 2));
    } else if (cmd === 'create-post-connect-tags') {
      const [id, userId, title, ...tagIds] = args;
      if (!id || !userId || !title || tagIds.length === 0) {
        console.error(
          'Usage: pnpm start -- create-post-connect-tags <id> <userId> <title> <tagId...>',
        );
        process.exitCode = 1;
        return;
      }
      const result = await ormClientCreatePostConnectTags({ id, userId, title, tagIds }, runtime);
      console.log(JSON.stringify(result, null, 2));
    } else if (cmd === 'integer-representations') {
      const limit = args[0] ? Number.parseInt(args[0], 10) : 10;
      const posts = await ormClientGetPostEngagement(limit, runtime);

      console.log('Post engagement counters, one column per integer representation:\n');
      console.log('  viewCount        BigIntNumber   sqlite/bigintnumber@1   read as a number');
      console.log('  impressionCount  BigInt         sqlite/bigint@1         read as a bigint\n');
      for (const post of posts) {
        console.log(post.title);
        console.log(`  viewCount        ${describe(post.viewCount)}`);
        console.log(`  impressionCount  ${describe(post.impressionCount)}`);
      }
      console.log(
        '\nSQLite declares no UnboundedInt: it has no lossless unbounded integer storage,',
      );
      console.log('so the type is simply not on offer. See examples/prisma-8-demo for all three.');
    } else if (cmd === 'aggregate-precision') {
      const report = await ormClientGetEngagementPrecision(runtime);

      console.log('Counting posts:');
      console.log(`  count()                       ${describe(report.posts.count)}`);
      console.log(`  countBigInt()                 ${describe(report.posts.countBigInt)}\n`);

      console.log('viewCount — BigIntNumber, and the total stays inside the safe range:');
      console.log(`  sum('viewCount')              ${describe(report.views.sum)}`);
      console.log(`  sumBigInt('viewCount')        ${describe(report.views.sumBigInt)}`);
      console.log(`  avg('viewCount')              ${describe(report.views.avg)}\n`);

      console.log('impressionCount — BigInt, and the total is 2^53 + 1000:');
      if (report.impressions.sum.kind === 'guarded') {
        console.log("  sum('impressionCount')        refused — this is the guard working:");
        console.log(`    ${report.impressions.sum.code}: ${report.impressions.sum.message}`);
        console.log('    A number cannot hold that total exactly, so the codec raises rather');
        console.log('    than rounding. Reach for the lossless variant instead:');
      } else {
        console.log(
          `  sum('impressionCount')        ${describe(report.impressions.sum.total)} — expected the guard here; is the database seeded?`,
        );
      }
      console.log(`  sumBigInt('impressionCount')  ${describe(report.impressions.sumBigInt)}\n`);

      console.log('There is no avgDecimal on a SQLite contract: an exact mean needs a decimal');
      console.log('result codec, and SQLite has none, so the method does not exist to call.');
    } else {
      console.log(
        'Usage: pnpm start -- [users [limit] | repo-user <id> | repo-user-posts <id> [limit] |\n' +
          '  repo-create-user <id> <email> <displayName> | insert-user <email> <displayName> |\n' +
          '  user-by-email-prepared <email> [<email> ...] |\n' +
          '  add-posts <userId> <title> [...moreTitles] |\n' +
          '  post-tags <postId> | tag-posts <tagId> |\n' +
          '  posts-with-tag-some <label> | posts-with-tag-none <label> | posts-with-tag-every <label> |\n' +
          '  connect-post-tags <postId> <tagId...> |\n' +
          '  disconnect-post-tags <postId> <tagId...> |\n' +
          '  create-post-with-tags <id> <userId> <title> <label...> |\n' +
          '  create-post-connect-tags <id> <userId> <title> <tagId...> |\n' +
          '  integer-representations [limit] | aggregate-precision]',
      );
      process.exitCode = 1;
      return;
    }
  } catch (error) {
    console.error('Error:', error);
    process.exitCode = 1;
  } finally {
    await runtime.close();
  }
}

await main();
