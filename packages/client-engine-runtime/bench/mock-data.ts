import type { ResultNode } from '../src/query-plan'

export function generateUserRows(count: number): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = []
  for (let i = 1; i <= count; i++) {
    rows.push({
      id: i,
      email: `user${i}@example.com`,
      name: `User ${i}`,
      bio: `This is the bio for user ${i}. It contains some text.`,
      avatar: `https://example.com/avatars/${i}.jpg`,
      isActive: i % 10 !== 0,
      role: i % 5 === 0 ? 'admin' : 'user',
      createdAt: '2024-01-15T12:00:00Z',
    })
  }
  return rows
}

export function generateNestedData(userCount: number, postsPerUser: number): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = []
  for (let i = 1; i <= userCount; i++) {
    const posts: Record<string, unknown>[] = []
    for (let j = 1; j <= postsPerUser; j++) {
      posts.push({
        id: (i - 1) * postsPerUser + j,
        title: `Post ${j} by User ${i}`,
        content: `This is the content of post ${j} by user ${i}. Lorem ipsum dolor sit amet.`,
        published: j % 3 !== 0,
        viewCount: j * 100,
      })
    }
    rows.push({
      id: i,
      email: `user${i}@example.com`,
      name: `User ${i}`,
      posts,
    })
  }
  return rows
}

export const USER_STRUCTURE: ResultNode = {
  type: 'object',
  serializedName: null,
  skipNulls: false,
  fields: {
    id: { type: 'field', dbName: 'id', fieldType: { type: 'int', arity: 'scalar' } },
    email: { type: 'field', dbName: 'email', fieldType: { type: 'string', arity: 'scalar' } },
    name: { type: 'field', dbName: 'name', fieldType: { type: 'string', arity: 'scalar' } },
    bio: { type: 'field', dbName: 'bio', fieldType: { type: 'string', arity: 'scalar' } },
    avatar: { type: 'field', dbName: 'avatar', fieldType: { type: 'string', arity: 'scalar' } },
    isActive: { type: 'field', dbName: 'isActive', fieldType: { type: 'boolean', arity: 'scalar' } },
    role: { type: 'field', dbName: 'role', fieldType: { type: 'string', arity: 'scalar' } },
    createdAt: { type: 'field', dbName: 'createdAt', fieldType: { type: 'datetime', arity: 'scalar' } },
  },
}

export const USER_WITH_POSTS_STRUCTURE: ResultNode = {
  type: 'object',
  serializedName: null,
  skipNulls: false,
  fields: {
    id: { type: 'field', dbName: 'id', fieldType: { type: 'int', arity: 'scalar' } },
    email: { type: 'field', dbName: 'email', fieldType: { type: 'string', arity: 'scalar' } },
    name: { type: 'field', dbName: 'name', fieldType: { type: 'string', arity: 'scalar' } },
    posts: {
      type: 'object',
      serializedName: 'posts',
      skipNulls: false,
      fields: {
        id: { type: 'field', dbName: 'id', fieldType: { type: 'int', arity: 'scalar' } },
        title: { type: 'field', dbName: 'title', fieldType: { type: 'string', arity: 'scalar' } },
        content: { type: 'field', dbName: 'content', fieldType: { type: 'string', arity: 'scalar' } },
        published: { type: 'field', dbName: 'published', fieldType: { type: 'boolean', arity: 'scalar' } },
        viewCount: { type: 'field', dbName: 'viewCount', fieldType: { type: 'int', arity: 'scalar' } },
      },
    },
  },
}
