import { useEffect, useState } from 'react';
import type { PostsResponse, UsersResponse } from '../server';
import { PostList } from './PostList';
import { UserList } from './UserList';

type Tab = 'posts' | 'users';

export function App() {
  const [tab, setTab] = useState<Tab>('posts');
  const [posts, setPosts] = useState<PostsResponse>([]);
  const [users, setUsers] = useState<UsersResponse>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const [postsRes, usersRes] = await Promise.all([fetch('/api/posts'), fetch('/api/users')]);

        if (!postsRes.ok || !usersRes.ok) {
          throw new Error('API request failed');
        }

        setPosts(await postsRes.json());
        setUsers(await usersRes.json());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="container">
        <div className="loading">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container">
        <div className="error">
          <h2>Error</h2>
          <p>{error}</p>
          <p className="hint">
            Make sure the API server is running: <code>pnpm dev:api</code>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <header>
        <h1>Blog</h1>
        <p className="subtitle">Prisma 8 — Mongo ORM demo with emitter-generated contract</p>
      </header>

      <nav className="tabs">
        <button
          type="button"
          className={tab === 'posts' ? 'active' : ''}
          onClick={() => setTab('posts')}
        >
          Posts ({posts.length})
        </button>
        <button
          type="button"
          className={tab === 'users' ? 'active' : ''}
          onClick={() => setTab('users')}
        >
          Authors ({users.length})
        </button>
      </nav>

      <main>{tab === 'posts' ? <PostList posts={posts} /> : <UserList users={users} />}</main>

      <footer>
        <div className="legend">
          <h3>Features demonstrated</h3>
          <ul>
            <li>
              <strong>Polymorphic models</strong> — <code>@@discriminator</code> /{' '}
              <code>@@base</code> produce discriminated union types; <code>.variant()</code> narrows
              queries
            </li>
            <li>
              <strong>Type-safe narrowing</strong> — <code>switch (post.kind)</code> gives access to{' '}
              <code>summary</code> on articles, <code>difficulty</code>/<code>duration</code> on
              tutorials
            </li>
            <li>
              <strong>Reference relations</strong> — Post.author resolves to User via{' '}
              <code>$lookup</code> on <code>authorId</code>
            </li>
            <li>
              <strong>Enums with $jsonSchema enforcement</strong> — <code>UserRole</code> (
              <code>admin</code> / <code>author</code> / <code>reader</code>) is authored in PSL,
              emitted into the contract, and enforced by MongoDB's <code>$jsonSchema</code>{' '}
              validator; <code>db.enums.UserRole.values</code> exposes the value set at runtime
            </li>
            <li>
              <strong>Contract-first types</strong> — All types derived from the emitted{' '}
              <code>contract.d.ts</code>
            </li>
          </ul>
        </div>
      </footer>
    </div>
  );
}
