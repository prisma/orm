/**
 * CLI Application Entry Point (Emitted Contract Workflow)
 *
 * This is a command-line demo application that showcases Prisma Next's query
 * capabilities using the standard emitted contract workflow:
 * - contract.json (runtime contract data)
 * - contract.d.ts (compile-time types)
 *
 * Run with: pnpm start -- <command> [args]
 *
 * Available commands:
 * - users [limit]              List users with optional limit
 * - user <id>                  Get user by ID
 * - posts <userId>             Get posts for a user
 * - user-by-email-prepared <email> [<email> ...]
 *                              Build a `PreparedStatement` once and reuse it for
 *                              each email — single lower(), single beforeCompile(),
 *                              repeated execute()
 * - repo-users [limit]         Users via ORM client API
 * - repo-admins [limit]        Admin users via custom collection scope
 * - repo-user <email>          Find a user by email via ORM client first()
 * - repo-posts <userId> [limit] Posts for a user via ORM client API
 * - repo-dashboard <emailDomain> <postTitleTerm> [limit] [postsPerUser]
 *                              Compound filters + select/include via ORM client
 * - repo-post-feed <postTitleTerm> [limit]
 *                              Posts with to-one include via ORM client
 * - repo-task-board [limit]    Users with their polymorphic `tasks` included —
 *                              each task comes back shaped per its variant
 *                              (Bug: severity/stepsToRepro, Feature: priority/targetRelease)
 * - repo-bug-triage [severity] [limit]
 *                              Users with a `.variant('Bug')`-narrowed include,
 *                              filtered by the Bug-only `severity` column
 * - repo-feature-roadmap <targetRelease> [limit]
 *                              Users with a `.variant('Feature')`-narrowed include,
 *                              filtered by the Feature-only `targetRelease` column
 * - repo-post-tags <postId>    Include a post's tags (N:M read through the junction)
 * - repo-tag-posts <tagId>     Include a tag's posts (N:M read, reverse direction)
 * - repo-posts-with-tag-some <label>
 *                              Posts that have at least one tag matching label
 * - repo-posts-with-tag-none <label>
 *                              Posts that have no tag matching label
 * - repo-posts-with-tag-every <label>
 *                              Posts where every tag differs from label
 *                              (includes posts with no tags)
 * - repo-connect-post-tags <postId> <tagId...>
 *                              Link existing tags to a post
 * - repo-disconnect-post-tags <postId> <tagId...>
 *                              Unlink tags from a post
 * - repo-create-post-with-tags <id> <userId> <title> <label...>
 *                              Create post + new tags in one nested mutation
 * - repo-create-post-connect-tags <id> <userId> <title> <tagId...>
 *                              Create post + link existing tags in one nested mutation
 * - repo-users-cursor [cursor] [limit]
 *                              Cursor pagination via ORM client
 * - repo-latest-per-kind       DISTINCT ON example via ORM client
 * - repo-user-insights [limit]
 *                              include().combine() metrics + latest related row
 * - repo-kind-breakdown [minUsers]
 *                              groupBy().having().aggregate() example
 * - repo-upsert-user <id> <email> <kind>
 *                              upsert() example for id conflict
 * - repo-create-user-address <id> <email> <kind>
 *                              Create user with embedded Address value object
 * - repo-similar-posts <postId> [limit]
 *                              Cosine-distance similarity search via ORM client
 * - repo-search-posts <embedding> <maxDistance> [limit]
 *                              Vector similarity search via ORM client
 * - users-paginate [cursor]    Cursor-based pagination
 * - similarity-search <vec>    Vector similarity search (pgvector)
 * - raw-sql-demo [limit]         `fns.raw` in projection + filter + typed-expression
 *                              interpolation, in one query
 * - raw-query-report [limit]     Whole-query raw read: one template, a row spec mixing
 *                              contract columns with a computed count, decoded typed rows
 * - raw-query-bump-views [kind]
 *                              Whole-query raw mutation terminated with `.affectedCount()`,
 *                              reporting how many rows it touched
 * - raw-query-active-authors [minPosts]
 *                              A CTE built by interpolating one row-spec'd raw query into
 *                              another — parts and params splice in, in order
 * - raw-query-promote <titleTerm>
 *                              A data-modifying CTE: `UPDATE … RETURNING` composed into an
 *                              outer query, which is what row-returning embeddability buys
 * - cross-author-similarity [limit]
 *                              SQL DSL escape-hatch: closest post pairs across different
 *                              authors via a self-join on a non-relation predicate, with
 *                              cosineDistance over two column references — a shape the
 *                              current ORM collection surface cannot directly express.
 * - cache-demo-user <id>       Cached `User.first({ id })` lookup. Runs the
 *                              same query twice and reports cache hit/miss
 *                              by comparing first- vs. second-call latency.
 * - cache-demo-users [limit]   Cached `User.all()` listing via ORM client.
 * - cache-demo-sql [limit]     Cached SQL DSL select. Runs the same plan
 *                              twice and observes the cache short-circuit.
 * - enum-priority [limit]       Prove PSL-authored Priority enum through the emitted contract:
 *                              db.enums.public.Priority.values (declaration order), typed
 *                              Post.priority read, and ORDER BY returning low→high→urgent
 * - enum-priority-filter [member] [limit]
 *                              Filter posts by a named Priority member using enum member accessor
 * - enum-default-demo          Insert a Post without `priority` (typed-optional thanks to
 *                              `@default(Low)` in the emitted contract), read it back, and
 *                              confirm the database supplied 'low'
 * - integer-representations [limit]
 *                              The three Post engagement counters side by side: `BigIntNumber`
 *                              reads as a JS number, `BigInt` as a bigint, and `UnboundedInt`
 *                              as a bigint that stays exact past 2^63
 * - aggregate-precision        count/sum/avg beside countBigInt/sumBigInt/avgDecimal. Includes
 *                              the case the split exists for: a bare sum() whose total passes
 *                              2^53 raises instead of rounding, and sumBigInt() answers it
 * - aggregate-stddev           An extension-contributed aggregate (`stddev`, from
 *                              src/extensions/engagement-stats.ts) called like a built-in
 * - budget-violation           Demo budget enforcement error
 * - guardrail-delete           Demo AST lint blocking DELETE without WHERE
 *
 * See also:
 * - main-no-emit.ts: Same CLI using inline contract (no emission step)
 * - src/app/main.tsx: React browser app for visualizing contract.json
 */
import 'dotenv/config';
import { loadAppConfig } from './app-config';
import { ormClientConnectPostTags } from './orm-client/connect-post-tags';
import { ormClientCreatePostConnectTags } from './orm-client/create-post-connect-tags';
import { ormClientCreatePostWithTags } from './orm-client/create-post-with-tags';
import { ormClientCreateUserWithAddress } from './orm-client/create-user-with-address';
import { ormClientDisconnectPostTags } from './orm-client/disconnect-post-tags';
import { ormClientFindSimilarPosts } from './orm-client/find-similar-posts';
import { ormClientFindUserByEmail } from './orm-client/find-user-by-email';
import { ormClientFindUserByIdCached } from './orm-client/find-user-by-id-cached';
import { ormClientGetAdminUsers } from './orm-client/get-admin-users';
import { ormClientGetDashboardUsers } from './orm-client/get-dashboard-users';
import { ormClientGetEngagementPrecision } from './orm-client/get-engagement-precision';
import { ormClientGetEngagementSpread } from './orm-client/get-engagement-spread';
import { ormClientGetFeatureRoadmap } from './orm-client/get-feature-roadmap';
import { ormClientGetLatestUserPerKind } from './orm-client/get-latest-user-per-kind';
import { ormClientGetPostEngagement } from './orm-client/get-post-engagement';
import { ormClientGetPostFeed } from './orm-client/get-post-feed';
import { ormClientGetPostTags } from './orm-client/get-post-tags';
import { ormClientGetPostsByTagFilter } from './orm-client/get-posts-by-tag-filter';
import { ormClientGetTagPosts } from './orm-client/get-tag-posts';
import { ormClientGetBugs, ormClientGetFeatures, ormClientGetTasks } from './orm-client/get-tasks';
import { ormClientGetUserBugTriage } from './orm-client/get-user-bug-triage';
import { ormClientGetUserInsights } from './orm-client/get-user-insights';
import { ormClientGetUserKindBreakdown } from './orm-client/get-user-kind-breakdown';
import { ormClientGetUserPosts } from './orm-client/get-user-posts';
import { ormClientGetUserTaskBoard } from './orm-client/get-user-task-board';
import { ormClientGetUsers } from './orm-client/get-users';
import { ormClientGetUsersBackwardCursor } from './orm-client/get-users-backward-cursor';
import { ormClientGetUsersByIdCursor } from './orm-client/get-users-by-id-cursor';
import { ormClientGetUsersCached } from './orm-client/get-users-cached';
import { ormClientSearchPostsByEmbedding } from './orm-client/search-posts-by-embedding';
import { ormClientUpsertUser } from './orm-client/upsert-user';
import { db } from './prisma/db';
import { crossAuthorSimilarity } from './queries/cross-author-similarity';
import { deleteWithoutWhere } from './queries/delete-without-where';
import { enumDefaultDemo } from './queries/enum-default-demo';
import { getAllPostsUnbounded } from './queries/get-all-posts-unbounded';
import { getPostsByPriority, getPostsByPriorityMember } from './queries/get-posts-by-priority';
import { getUserByEmailPrepared } from './queries/get-user-by-email-prepared';
import { getUserById } from './queries/get-user-by-id';
import { getUserPosts } from './queries/get-user-posts';
import { getUsers } from './queries/get-users';
import { getUsersCached } from './queries/get-users-cached';
import {
  rawQueryActiveAuthors,
  rawQueryBumpViews,
  rawQueryPromoteAndList,
  rawQueryReport,
} from './queries/raw-query-demo';
import { rawSqlDemo } from './queries/raw-sql-demo';
import { similaritySearch } from './queries/similarity-search';

const argv = process.argv.slice(2).filter((arg) => arg !== '--');
const [cmd, ...args] = argv;

function displayNameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? email;
  return local.length > 0 ? local.charAt(0).toUpperCase() + local.slice(1) : email;
}

/**
 * Renders a value with the JavaScript type it arrived as. The
 * integer-representation demos are about exactly that, and `JSON.stringify`
 * cannot help: it refuses a `bigint` outright.
 */
function describe(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'bigint') return `${value}n (bigint)`;
  if (typeof value === 'string') return `'${value}' (string)`;
  return `${String(value)} (${typeof value})`;
}

/**
 * `JSON.stringify` refuses a `bigint`, and a raw row spec naming an
 * `pg/int8@1` column decodes to one — so counts come back as bigints. Render
 * them with the `n` suffix the value would carry in source.
 */
function toJson(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, entry) => (typeof entry === 'bigint' ? `${entry}n` : entry),
    2,
  );
}

async function main() {
  const { databaseUrl } = loadAppConfig();
  const runtime = await db.connect({ url: databaseUrl });

  try {
    if (cmd === 'users') {
      const limit = args[0] ? Number.parseInt(args[0], 10) : 10;
      const users = await getUsers(limit);

      console.log(JSON.stringify(users, null, 2));
    } else if (cmd === 'user') {
      const [userIdStr] = args;
      if (!userIdStr) {
        console.error('Usage: pnpm start -- user <userId>');
        process.exit(1);
      }
      const user = await getUserById(userIdStr);

      console.log(JSON.stringify(user, null, 2));
    } else if (cmd === 'posts') {
      const [userIdStr] = args;
      if (!userIdStr) {
        console.error('Usage: pnpm start -- posts <userId>');
        process.exit(1);
      }
      const posts = await getUserPosts(userIdStr);

      console.log(JSON.stringify(posts, null, 2));
    } else if (cmd === 'user-by-email-prepared') {
      if (args.length === 0) {
        console.error('Usage: pnpm start -- user-by-email-prepared <email> [<email> ...]');
        process.exit(1);
      }
      const results = await getUserByEmailPrepared(args);

      console.log(JSON.stringify(results, null, 2));
    } else if (cmd === 'repo-users') {
      const limit = args[0] ? Number.parseInt(args[0], 10) : 10;
      const users = await ormClientGetUsers(limit, runtime);

      console.log(JSON.stringify(users, null, 2));
    } else if (cmd === 'repo-admins') {
      const limit = args[0] ? Number.parseInt(args[0], 10) : 10;
      const users = await ormClientGetAdminUsers(limit, runtime);

      console.log(JSON.stringify(users, null, 2));
    } else if (cmd === 'repo-user') {
      const [email] = args;
      if (!email) {
        console.error('Usage: pnpm start -- repo-user <email>');
        process.exit(1);
      }
      const user = await ormClientFindUserByEmail(email, runtime);

      console.log(JSON.stringify(user, null, 2));
    } else if (cmd === 'repo-posts') {
      const [userIdStr, limitStr] = args;
      if (!userIdStr) {
        console.error('Usage: pnpm start -- repo-posts <userId> [limit]');
        process.exit(1);
      }
      const limit = limitStr ? Number.parseInt(limitStr, 10) : 10;
      const posts = await ormClientGetUserPosts(userIdStr, limit, runtime);

      console.log(JSON.stringify(posts, null, 2));
    } else if (cmd === 'repo-dashboard') {
      const [emailDomain, postTitleTerm, limitStr, postsPerUserStr] = args;
      if (!emailDomain || !postTitleTerm) {
        console.error(
          'Usage: pnpm start -- repo-dashboard <emailDomain> <postTitleTerm> [limit] [postsPerUser]',
        );
        process.exit(1);
      }
      const limit = limitStr ? Number.parseInt(limitStr, 10) : 10;
      const postsPerUser = postsPerUserStr ? Number.parseInt(postsPerUserStr, 10) : 2;
      const users = await ormClientGetDashboardUsers(
        emailDomain,
        postTitleTerm,
        limit,
        postsPerUser,
        runtime,
      );

      console.log(JSON.stringify(users, null, 2));
    } else if (cmd === 'repo-post-feed') {
      const [postTitleTerm, limitStr] = args;
      if (!postTitleTerm) {
        console.error('Usage: pnpm start -- repo-post-feed <postTitleTerm> [limit]');
        process.exit(1);
      }
      const limit = limitStr ? Number.parseInt(limitStr, 10) : 10;
      const posts = await ormClientGetPostFeed(postTitleTerm, limit, runtime);

      console.log(JSON.stringify(posts, null, 2));
    } else if (cmd === 'repo-users-cursor') {
      const [cursorStr, limitStr] = args;
      const cursor = cursorStr ?? null;
      const limit = limitStr ? Number.parseInt(limitStr, 10) : 10;
      const users = await ormClientGetUsersByIdCursor(cursor, limit, runtime);

      console.log(JSON.stringify(users, null, 2));
    } else if (cmd === 'repo-latest-per-kind') {
      const users = await ormClientGetLatestUserPerKind(runtime);

      console.log(JSON.stringify(users, null, 2));
    } else if (cmd === 'repo-user-insights') {
      const limit = args[0] ? Number.parseInt(args[0], 10) : 10;
      const users = await ormClientGetUserInsights(limit, runtime);

      console.log(JSON.stringify(users, null, 2));
    } else if (cmd === 'repo-kind-breakdown') {
      const minUsers = args[0] ? Number.parseInt(args[0], 10) : 1;
      const rows = await ormClientGetUserKindBreakdown(minUsers, runtime);

      console.log(JSON.stringify(rows, null, 2));
    } else if (cmd === 'repo-tasks') {
      const limit = args[0] ? Number.parseInt(args[0], 10) : 10;
      const tasks = await ormClientGetTasks(limit, runtime);

      console.log(JSON.stringify(tasks, null, 2));
    } else if (cmd === 'repo-bugs') {
      const limit = args[0] ? Number.parseInt(args[0], 10) : 10;
      const bugs = await ormClientGetBugs(limit, runtime);

      console.log(JSON.stringify(bugs, null, 2));
    } else if (cmd === 'repo-features') {
      const limit = args[0] ? Number.parseInt(args[0], 10) : 10;
      const features = await ormClientGetFeatures(limit, runtime);

      console.log(JSON.stringify(features, null, 2));
    } else if (cmd === 'repo-task-board') {
      const limit = args[0] ? Number.parseInt(args[0], 10) : 10;
      const board = await ormClientGetUserTaskBoard(limit, runtime);

      console.log(JSON.stringify(board, null, 2));
    } else if (cmd === 'repo-bug-triage') {
      const [severity, limitStr] = args;
      const limit = limitStr ? Number.parseInt(limitStr, 10) : 10;
      const triage = await ormClientGetUserBugTriage(severity ?? 'critical', limit, runtime);

      console.log(JSON.stringify(triage, null, 2));
    } else if (cmd === 'repo-feature-roadmap') {
      const [targetRelease, limitStr] = args;
      if (!targetRelease) {
        console.error('Usage: pnpm start -- repo-feature-roadmap <targetRelease> [limit]');
        process.exit(1);
      }
      const limit = limitStr ? Number.parseInt(limitStr, 10) : 10;
      const roadmap = await ormClientGetFeatureRoadmap(targetRelease, limit, runtime);

      console.log(JSON.stringify(roadmap, null, 2));
    } else if (cmd === 'repo-post-tags') {
      const [postId] = args;
      if (!postId) {
        console.error('Usage: pnpm start -- repo-post-tags <postId>');
        process.exit(1);
      }
      const result = await ormClientGetPostTags(postId, runtime);

      console.log(JSON.stringify(result, null, 2));
    } else if (cmd === 'repo-tag-posts') {
      const [tagId] = args;
      if (!tagId) {
        console.error('Usage: pnpm start -- repo-tag-posts <tagId>');
        process.exit(1);
      }
      const result = await ormClientGetTagPosts(tagId, runtime);

      console.log(JSON.stringify(result, null, 2));
    } else if (
      cmd === 'repo-posts-with-tag-some' ||
      cmd === 'repo-posts-with-tag-none' ||
      cmd === 'repo-posts-with-tag-every'
    ) {
      const [label] = args;
      if (!label) {
        console.error(`Usage: pnpm start -- ${cmd} <label>`);
        process.exit(1);
      }
      const mode =
        cmd === 'repo-posts-with-tag-some'
          ? 'some'
          : cmd === 'repo-posts-with-tag-none'
            ? 'none'
            : 'every';
      const result = await ormClientGetPostsByTagFilter(mode, label, runtime);

      console.log(JSON.stringify(result, null, 2));
    } else if (cmd === 'repo-connect-post-tags') {
      const [postId, ...tagIds] = args;
      if (!postId || tagIds.length === 0) {
        console.error('Usage: pnpm start -- repo-connect-post-tags <postId> <tagId...>');
        process.exit(1);
      }
      const result = await ormClientConnectPostTags(postId, tagIds, runtime);

      console.log(JSON.stringify(result, null, 2));
    } else if (cmd === 'repo-disconnect-post-tags') {
      const [postId, ...tagIds] = args;
      if (!postId || tagIds.length === 0) {
        console.error('Usage: pnpm start -- repo-disconnect-post-tags <postId> <tagId...>');
        process.exit(1);
      }
      const result = await ormClientDisconnectPostTags(postId, tagIds, runtime);

      console.log(JSON.stringify(result, null, 2));
    } else if (cmd === 'repo-create-post-with-tags') {
      const [id, userId, title, ...labels] = args;
      if (!id || !userId || !title || labels.length === 0) {
        console.error(
          'Usage: pnpm start -- repo-create-post-with-tags <id> <userId> <title> <label...>',
        );
        process.exit(1);
      }
      const result = await ormClientCreatePostWithTags(
        { id, userId, title, tags: labels.map((label) => ({ label })) },
        runtime,
      );

      console.log(JSON.stringify(result, null, 2));
    } else if (cmd === 'repo-create-post-connect-tags') {
      const [id, userId, title, ...tagIds] = args;
      if (!id || !userId || !title || tagIds.length === 0) {
        console.error(
          'Usage: pnpm start -- repo-create-post-connect-tags <id> <userId> <title> <tagId...>',
        );
        process.exit(1);
      }
      const result = await ormClientCreatePostConnectTags({ id, userId, title, tagIds }, runtime);

      console.log(JSON.stringify(result, null, 2));
    } else if (cmd === 'repo-upsert-user') {
      const [id, email, kind] = args;
      if (!id || !email || !kind) {
        console.error('Usage: pnpm start -- repo-upsert-user <id> <email> <kind>');
        process.exit(1);
      }
      if (kind !== 'admin' && kind !== 'user') {
        console.error('repo-upsert-user kind must be "admin" or "user"');
        process.exit(1);
      }
      const user = await ormClientUpsertUser(
        { id, email, displayName: displayNameFromEmail(email), kind },
        runtime,
      );

      console.log(JSON.stringify(user, null, 2));
    } else if (cmd === 'repo-create-user-address') {
      const [id, email, kind] = args;
      if (!id || !email || !kind) {
        console.error('Usage: pnpm start -- repo-create-user-address <id> <email> <kind>');
        process.exit(1);
      }
      if (kind !== 'admin' && kind !== 'user') {
        console.error('repo-create-user-address kind must be "admin" or "user"');
        process.exit(1);
      }
      const user = await ormClientCreateUserWithAddress(
        {
          id,
          email,
          displayName: displayNameFromEmail(email),
          kind,
          createdAt: Temporal.Now.instant(),
          address: { street: '789 Elm Blvd', city: 'Austin', zip: '73301', country: 'US' },
        },
        runtime,
      );

      console.log(JSON.stringify(user, null, 2));
    } else if (cmd === 'repo-similar-posts') {
      const [postId, limitStr] = args;
      if (!postId) {
        console.error('Usage: pnpm start -- repo-similar-posts <postId> [limit]');
        process.exit(1);
      }
      const limit = limitStr ? Number.parseInt(limitStr, 10) : 10;
      const posts = await ormClientFindSimilarPosts(postId, limit, runtime);

      console.log(JSON.stringify(posts, null, 2));
    } else if (cmd === 'repo-search-posts') {
      const [embeddingStr, maxDistanceStr, limitStr] = args;
      if (!embeddingStr || !maxDistanceStr) {
        console.error('Usage: pnpm start -- repo-search-posts <embedding> <maxDistance> [limit]');
        console.error('  embedding: JSON array of numbers, e.g., "[0.1,0.2,0.3]"');
        process.exit(1);
      }
      let searchEmbedding: number[];
      try {
        searchEmbedding = JSON.parse(embeddingStr) as number[];
        if (
          !Array.isArray(searchEmbedding) ||
          !searchEmbedding.every((v) => typeof v === 'number')
        ) {
          throw new Error('embedding must be an array of numbers');
        }
      } catch (error) {
        console.error(
          'Error parsing embedding:',
          error instanceof Error ? error.message : String(error),
        );
        console.error('Expected JSON array of numbers, e.g., "[0.1,0.2,0.3]"');
        process.exit(1);
      }
      const maxDistance = Number.parseFloat(maxDistanceStr);
      const limit = limitStr ? Number.parseInt(limitStr, 10) : 10;
      const posts = await ormClientSearchPostsByEmbedding(
        searchEmbedding,
        maxDistance,
        limit,
        runtime,
      );

      console.log(JSON.stringify(posts, null, 2));
    } else if (cmd === 'users-paginate') {
      const [cursorStr, limitStr] = args;
      const cursor = cursorStr ?? null;
      const limit = limitStr ? Number.parseInt(limitStr, 10) : 10;
      const users = await ormClientGetUsersByIdCursor(cursor, limit, runtime);

      console.log(JSON.stringify(users, null, 2));
    } else if (cmd === 'users-paginate-back') {
      const [cursorStr, limitStr] = args;
      if (!cursorStr) {
        console.error('Usage: pnpm start -- users-paginate-back <cursor> [limit]');
        process.exit(1);
      }
      const limit = limitStr ? Number.parseInt(limitStr, 10) : 10;
      const users = await ormClientGetUsersBackwardCursor(cursorStr, limit, runtime);

      console.log(JSON.stringify(users, null, 2));
    } else if (cmd === 'similarity-search') {
      const [queryVectorStr, limitStr] = args;
      if (!queryVectorStr) {
        console.error('Usage: pnpm start -- similarity-search <queryVector> [limit]');
        console.error('  queryVector: JSON array of numbers, e.g., "[0.1,0.2,0.3]"');
        process.exit(1);
      }
      let queryVector: number[];
      try {
        queryVector = JSON.parse(queryVectorStr) as number[];
        if (!Array.isArray(queryVector) || !queryVector.every((v) => typeof v === 'number')) {
          throw new Error('queryVector must be an array of numbers');
        }
      } catch (error) {
        console.error(
          'Error parsing queryVector:',
          error instanceof Error ? error.message : String(error),
        );
        console.error('Expected JSON array of numbers, e.g., "[0.1,0.2,0.3]"');
        process.exit(1);
      }
      const limit = limitStr ? Number.parseInt(limitStr, 10) : 10;
      const results = await similaritySearch(queryVector, limit);

      console.log(JSON.stringify(results, null, 2));
    } else if (cmd === 'raw-sql-demo') {
      const [limitStr] = args;
      const limit = limitStr ? Number.parseInt(limitStr, 10) : 10;
      const results = await rawSqlDemo(limit);

      console.log(JSON.stringify(results, null, 2));
    } else if (cmd === 'raw-query-report') {
      const [limitStr] = args;
      const limit = limitStr ? Number.parseInt(limitStr, 10) : 10;
      const results = await rawQueryReport(limit);

      console.log(toJson(results));
    } else if (cmd === 'raw-query-bump-views') {
      const [kind] = args;
      const stats = await rawQueryBumpViews(kind ?? 'admin');

      console.log(toJson(stats));
    } else if (cmd === 'raw-query-active-authors') {
      const [minPostsStr] = args;
      const minPosts = minPostsStr ? Number.parseInt(minPostsStr, 10) : 1;
      const results = await rawQueryActiveAuthors(minPosts);

      console.log(toJson(results));
    } else if (cmd === 'raw-query-promote') {
      const [titleTerm] = args;
      if (!titleTerm) {
        console.error('Usage: pnpm start -- raw-query-promote <titleTerm>');
        process.exit(1);
      }
      const results = await rawQueryPromoteAndList(titleTerm);

      console.log(toJson(results));
    } else if (cmd === 'cross-author-similarity') {
      const [limitStr] = args;
      const limit = limitStr ? Number.parseInt(limitStr, 10) : 10;
      const results = await crossAuthorSimilarity(limit);

      console.log(JSON.stringify(results, null, 2));
    } else if (cmd === 'cache-demo-user') {
      const [userIdStr] = args;
      if (!userIdStr) {
        console.error('Usage: pnpm start -- cache-demo-user <userId>');
        process.exit(1);
      }
      console.log('Demonstrating opt-in caching with cacheAnnotation...');
      console.log(
        `Calling User.first({ id: ${userIdStr} }) twice — second call should hit cache.\n`,
      );

      const firstStart = performance.now();
      const first = await ormClientFindUserByIdCached(userIdStr, runtime);
      const firstMs = performance.now() - firstStart;

      const secondStart = performance.now();
      const second = await ormClientFindUserByIdCached(userIdStr, runtime);
      const secondMs = performance.now() - secondStart;

      console.log(`First call (cache miss):  ${firstMs.toFixed(2)}ms`);
      console.log(`Second call (cache hit):  ${secondMs.toFixed(2)}ms`);
      console.log(`Speedup: ${(firstMs / Math.max(secondMs, 0.001)).toFixed(1)}x faster`);
      console.log('\nResult (identical between calls):');
      console.log(JSON.stringify(second, null, 2));
      void first;
    } else if (cmd === 'cache-demo-users') {
      const limit = args[0] ? Number.parseInt(args[0], 10) : 10;
      console.log('Demonstrating opt-in caching with cacheAnnotation on User.all()...');
      console.log(`Listing ${limit} users twice — second call should hit cache.\n`);

      const firstStart = performance.now();
      const first = await ormClientGetUsersCached(limit, runtime);
      const firstMs = performance.now() - firstStart;

      const secondStart = performance.now();
      const second = await ormClientGetUsersCached(limit, runtime);
      const secondMs = performance.now() - secondStart;

      console.log(`First call (cache miss):  ${firstMs.toFixed(2)}ms`);
      console.log(`Second call (cache hit):  ${secondMs.toFixed(2)}ms`);
      console.log(`Speedup: ${(firstMs / Math.max(secondMs, 0.001)).toFixed(1)}x faster`);
      console.log(`\nReturned ${second.length} rows (identical between calls).`);
      void first;
    } else if (cmd === 'cache-demo-sql') {
      const limit = args[0] ? Number.parseInt(args[0], 10) : 10;
      console.log('Demonstrating opt-in caching via SQL DSL .annotate(cacheAnnotation(...))...');
      console.log('Running the same select twice — second call should hit cache.\n');

      const firstStart = performance.now();
      const first = await getUsersCached(limit);
      const firstMs = performance.now() - firstStart;

      const secondStart = performance.now();
      const second = await getUsersCached(limit);
      const secondMs = performance.now() - secondStart;

      console.log(`First call (cache miss):  ${firstMs.toFixed(2)}ms`);
      console.log(`Second call (cache hit):  ${secondMs.toFixed(2)}ms`);
      console.log(`Speedup: ${(firstMs / Math.max(secondMs, 0.001)).toFixed(1)}x faster`);
      console.log(`\nReturned ${second.length} rows (identical between calls).`);
      void first;
    } else if (cmd === 'budget-violation') {
      console.log('Running unbounded query to demonstrate budget violation...');

      console.log('This query has no LIMIT clause and will trigger BUDGET.ROWS_EXCEEDED error.\n');
      try {
        const result = await getAllPostsUnbounded();

        console.log(JSON.stringify(result, null, 2));
      } catch (error) {
        console.error('Budget violation caught:');
        if (error instanceof Error) {
          const budgetError = error as { code?: string; category?: string; details?: unknown };
          console.error('  Code:', budgetError.code);
          console.error('  Category:', budgetError.category);
          console.error('  Message:', error.message);
          if (budgetError.details) {
            console.error('  Details:', JSON.stringify(budgetError.details, null, 2));
          }
        } else {
          console.error('  Error:', error);
        }
        throw error; // Re-throw to show the full error stack
      }
    } else if (cmd === 'enum-priority') {
      const limit = args[0] ? Number.parseInt(args[0], 10) : 10;
      const priority = db.enums.public.Priority;

      console.log('Priority enum values (declaration order):', priority.values);
      console.log('Priority enum members:', priority.members);

      const posts = await getPostsByPriority(limit);
      console.log(`\nPosts ordered by priority (${posts.length} rows):`);
      console.log(JSON.stringify(posts, null, 2));
    } else if (cmd === 'enum-priority-filter') {
      const [memberName, limitStr] = args;
      const limit = limitStr ? Number.parseInt(limitStr, 10) : 10;
      const priority = db.enums.public.Priority;
      const requested = memberName ?? 'Low';
      if (!priority.hasName(requested)) {
        console.error(
          `Unknown Priority member "${requested}" — expected one of: ${Object.keys(priority.members).join(', ')}`,
        );
        process.exit(1);
      }
      const posts = await getPostsByPriorityMember(priority.members[requested], limit);
      console.log(`Posts with priority=${requested} (${posts.length} rows):`);
      console.log(JSON.stringify(posts, null, 2));
    } else if (cmd === 'enum-default-demo') {
      console.log(
        'Demonstrating enum member default: inserting a Post without priority, then reading it back...',
      );
      await enumDefaultDemo();
    } else if (cmd === 'integer-representations') {
      const limit = args[0] ? Number.parseInt(args[0], 10) : 10;
      const posts = await ormClientGetPostEngagement(limit, runtime);

      console.log('Post engagement counters, one column per integer representation:\n');
      console.log('  viewCount        BigIntNumber   pg/int8number@1     int8 read as a number');
      console.log('  impressionCount  BigInt         pg/int8@1           int8 read as a bigint');
      console.log(
        '  reachScore       UnboundedInt   pg/unboundedint@1   numeric read as a bigint\n',
      );
      for (const post of posts) {
        console.log(post.title);
        console.log(`  viewCount        ${describe(post.viewCount)}`);
        console.log(`  impressionCount  ${describe(post.impressionCount)}`);
        console.log(`  reachScore       ${describe(post.reachScore)}`);
      }
      console.log(
        '\nTwo reachScore values are past 2^63, where an int8 column would have overflowed.',
      );
    } else if (cmd === 'aggregate-precision') {
      const report = await ormClientGetEngagementPrecision(runtime);

      console.log('Counting posts:');
      console.log(`  count()                       ${describe(report.posts.count)}`);
      console.log(`  countBigInt()                 ${describe(report.posts.countBigInt)}\n`);

      console.log('viewCount — BigIntNumber, and the total stays inside the safe range:');
      console.log(`  sum('viewCount')              ${describe(report.views.sum)}`);
      console.log(`  sumBigInt('viewCount')        ${describe(report.views.sumBigInt)}`);
      console.log(`  avg('viewCount')              ${describe(report.views.avg)}`);
      console.log(`  avgDecimal('viewCount')       ${describe(report.views.avgDecimal)}\n`);

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

      console.log('reachScore — UnboundedInt, so even the bare sum is exact:');
      console.log(`  sum('reachScore')             ${describe(report.reach.sum)}`);
      console.log(`  sumBigInt('reachScore')       ${describe(report.reach.sumBigInt)}`);
    } else if (cmd === 'aggregate-stddev') {
      const spread = await ormClientGetEngagementSpread(runtime);

      console.log('`stddev` is contributed by src/extensions/engagement-stats.ts, not by the');
      console.log('PostgreSQL target — yet it is called like any built-in aggregate:\n');
      console.log(`  count()                       ${describe(spread.posts)}`);
      console.log(`  avg('viewCount')              ${describe(spread.meanViews)}`);
      console.log(`  stddev('viewCount')           ${describe(spread.viewSpread)}`);
      console.log(`  stddev('impressionCount')     ${describe(spread.impressionSpread)}`);
      console.log(
        '\nIts result is a decimal string because that is the codec its descriptor declares.',
      );
    } else if (cmd === 'guardrail-delete') {
      console.log('Running DELETE without WHERE to demonstrate AST-based lint guardrail...');
      try {
        await deleteWithoutWhere();
        console.error('Unexpected: query should have been blocked by LINT.DELETE_WITHOUT_WHERE');
        process.exit(1);
      } catch (error) {
        if (
          typeof error === 'object' &&
          error !== null &&
          Object.hasOwn(error, 'code') &&
          Reflect.get(error, 'code') === 'LINT.DELETE_WITHOUT_WHERE'
        ) {
          console.log('Guardrail correctly blocked execution: LINT.DELETE_WITHOUT_WHERE');
        } else {
          throw error;
        }
      }
    } else {
      console.log(
        'Usage: pnpm start -- [users [limit] | user <userId> | posts <userId> | ' +
          'repo-users [limit] | repo-admins [limit] | ' +
          'repo-user <email> | repo-posts <userId> [limit] | ' +
          'repo-dashboard <emailDomain> <postTitleTerm> [limit] [postsPerUser] | ' +
          'repo-post-feed <postTitleTerm> [limit] | repo-users-cursor [cursor] [limit] | ' +
          'repo-tasks [limit] | repo-bugs [limit] | repo-features [limit] | ' +
          'repo-task-board [limit] | repo-bug-triage [severity] [limit] | ' +
          'repo-feature-roadmap <targetRelease> [limit] | ' +
          'repo-post-tags <postId> | repo-tag-posts <tagId> | ' +
          'repo-posts-with-tag-some <label> | repo-posts-with-tag-none <label> | ' +
          'repo-posts-with-tag-every <label> | ' +
          'repo-connect-post-tags <postId> <tagId...> | ' +
          'repo-disconnect-post-tags <postId> <tagId...> | ' +
          'repo-create-post-with-tags <id> <userId> <title> <label...> | ' +
          'repo-create-post-connect-tags <id> <userId> <title> <tagId...> | ' +
          'repo-latest-per-kind | repo-user-insights [limit] | repo-kind-breakdown [minUsers] | ' +
          'repo-upsert-user <id> <email> <kind> | repo-create-user-address <id> <email> <kind> | ' +
          'repo-similar-posts <postId> [limit] | repo-search-posts <embedding> <maxDistance> [limit] | ' +
          'users-paginate [cursor] [limit] | users-paginate-back <cursor> [limit] | ' +
          'similarity-search <vec> [limit] | cross-author-similarity [limit] | raw-sql-demo [limit] | ' +
          'raw-query-report [limit] | raw-query-bump-views [kind] | raw-query-active-authors [minPosts] | ' +
          'raw-query-promote <titleTerm> | ' +
          'cache-demo-user <userId> | cache-demo-users [limit] | cache-demo-sql [limit] | ' +
          'enum-priority [limit] | enum-priority-filter [member] [limit] | enum-default-demo | ' +
          'integer-representations [limit] | aggregate-precision | aggregate-stddev | ' +
          'budget-violation | guardrail-delete]',
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
