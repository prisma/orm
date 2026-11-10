import { existsSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import type { SimplifyDeep } from '@prisma/orm-mongo/utils/simplify-deep';

if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

import {
  MongoCountStage,
  MongoLimitStage,
  MongoSortStage,
} from '@prisma/orm-mongo/query-ast/execution';
import { acc, fn } from '@prisma/orm-mongo/query-builder';
import type { Db } from './db';
import { createClient } from './db';
import { seed } from './seed';

const PORT = Number(process.env['PORT'] ?? 3456);
const DB_NAME = 'blog';

// ---------------------------------------------------------------------------
// ORM queries
// ---------------------------------------------------------------------------

export async function getPosts(orm: Db['orm']) {
  return orm.posts.include('author').all();
}

export async function getArticles(orm: Db['orm']) {
  return orm.posts.variant('article').all();
}

export async function getTutorials(orm: Db['orm']) {
  return orm.posts.variant('tutorial').all();
}

export async function getUsers(orm: Db['orm']) {
  return orm.users.all();
}

export function getRoles(enums: Db['enums']) {
  return enums.UserRole.values;
}

export type PostsResponse = SimplifyDeep<Awaited<ReturnType<typeof getPosts>>>;
export type ArticlesResponse = SimplifyDeep<Awaited<ReturnType<typeof getArticles>>>;
export type TutorialsResponse = SimplifyDeep<Awaited<ReturnType<typeof getTutorials>>>;
export type UsersResponse = SimplifyDeep<Awaited<ReturnType<typeof getUsers>>>;
export type RolesResponse = ReturnType<typeof getRoles>;

// ---------------------------------------------------------------------------
// Pipeline DSL queries — type-safe aggregation pipelines
// ---------------------------------------------------------------------------

export async function getAuthorLeaderboard(query: Db['query'], runtime: Db['runtime']) {
  const plan = query
    .from('posts')
    .group((f) => ({
      _id: f.authorId,
      postCount: acc.count(),
      latestPost: acc.max(f.createdAt),
    }))
    .sort({ postCount: -1 })
    .lookup((from) =>
      from('users')
        .on((local, foreign) => ({
          local: local._id,
          foreign: foreign._id,
        }))
        .as('author'),
    )
    .build();

  return runtime.query(plan);
}

export async function getRecentPostSummaries(query: Db['query'], runtime: Db['runtime']) {
  const plan = query
    .from('posts')
    .sort({ createdAt: -1 })
    .limit(3)
    .addFields((f) => ({
      titleUpper: fn.toUpper(f.title),
    }))
    .project('title', 'titleUpper', 'authorId', 'createdAt')
    .build();

  return runtime.query(plan);
}

export async function getPostsWithAuthors(query: Db['query'], runtime: Db['runtime']) {
  const plan = query
    .from('posts')
    .lookup((from) =>
      from('users')
        .on((local, foreign) => ({
          local: local.authorId,
          foreign: foreign._id,
        }))
        .as('authorInfo'),
    )
    .sort({ createdAt: -1 })
    .build();

  return runtime.query(plan);
}

export async function getDashboard(query: Db['query'], runtime: Db['runtime']) {
  const plan = query
    .from('posts')
    .facet({
      totalPosts: [new MongoCountStage('count')],
      recentPosts: [new MongoSortStage({ createdAt: -1 }), new MongoLimitStage(2)],
      postsByAuthor: [new MongoSortStage({ authorId: 1 })],
    })
    .build();

  return runtime.query(plan);
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

function jsonResponse(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function main() {
  const externalUrl = process.env['MONGODB_URL'];
  let uri: string;
  let stopMemoryServer: (() => Promise<void>) | undefined;

  if (externalUrl) {
    uri = externalUrl;
    console.log(`Connecting to external MongoDB at ${uri}`);
  } else {
    const { MongoMemoryReplSet } = await import('mongodb-memory-server');
    console.log('No MONGODB_URL set — starting in-memory MongoDB...');
    const replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    uri = replSet.getUri();
    stopMemoryServer = async () => {
      await replSet.stop();
    };
    console.log(`In-memory MongoDB ready at ${uri}`);
  }

  const { orm, runtime, query, enums } = await createClient(uri, DB_NAME);

  if (!externalUrl) {
    console.log('Seeding data...');
    await seed(orm);
    console.log('Seed complete.');
  }

  const server = createServer(async (req, res) => {
    try {
      if (req.method === 'GET' && req.url === '/api/posts') {
        jsonResponse(res, await getPosts(orm));
      } else if (req.method === 'GET' && req.url === '/api/posts/articles') {
        jsonResponse(res, await getArticles(orm));
      } else if (req.method === 'GET' && req.url === '/api/posts/tutorials') {
        jsonResponse(res, await getTutorials(orm));
      } else if (req.method === 'GET' && req.url === '/api/users') {
        jsonResponse(res, await getUsers(orm));
      } else if (req.method === 'GET' && req.url === '/api/roles') {
        jsonResponse(res, getRoles(enums));
      } else if (req.method === 'GET' && req.url === '/api/pipeline/leaderboard') {
        jsonResponse(res, await getAuthorLeaderboard(query, runtime));
      } else if (req.method === 'GET' && req.url === '/api/pipeline/recent') {
        jsonResponse(res, await getRecentPostSummaries(query, runtime));
      } else if (req.method === 'GET' && req.url === '/api/pipeline/posts-with-authors') {
        jsonResponse(res, await getPostsWithAuthors(query, runtime));
      } else if (req.method === 'GET' && req.url === '/api/pipeline/dashboard') {
        jsonResponse(res, await getDashboard(query, runtime));
      } else {
        jsonResponse(res, { error: 'Not found' }, 404);
      }
    } catch (err) {
      console.error('Request error:', err);
      jsonResponse(res, { error: 'Internal server error' }, 500);
    }
  });

  server.listen(PORT, () => {
    console.log(`API server listening on http://localhost:${PORT}`);
    console.log('Endpoints:');
    console.log(`  GET http://localhost:${PORT}/api/posts`);
    console.log(`  GET http://localhost:${PORT}/api/posts/articles   (variant: Article)`);
    console.log(`  GET http://localhost:${PORT}/api/posts/tutorials  (variant: Tutorial)`);
    console.log(`  GET http://localhost:${PORT}/api/users`);
    console.log(`  GET http://localhost:${PORT}/api/roles          (enum values via db.enums)`);
    console.log('Pipeline DSL endpoints:');
    console.log(`  GET http://localhost:${PORT}/api/pipeline/leaderboard`);
    console.log(`  GET http://localhost:${PORT}/api/pipeline/recent`);
    console.log(`  GET http://localhost:${PORT}/api/pipeline/posts-with-authors`);
    console.log(`  GET http://localhost:${PORT}/api/pipeline/dashboard`);
  });

  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    server.close();
    await runtime.close();
    await stopMemoryServer?.();
    process.exit(0);
  });
}

if (import.meta.filename === process.argv[1]) {
  main().catch((err) => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
