import type { PostsResponse } from '../server';

type Post = PostsResponse[number];
type Article = Extract<Post, { kind: 'article' }>;
type Tutorial = Extract<Post, { kind: 'tutorial' }>;

function ArticleCard({ post }: { post: Article }) {
  return (
    <div className="card card-article">
      <div className="card-header">
        <span className="type-badge type-article">Article</span>
        <h3>{post.title}</h3>
      </div>
      <p className="card-summary">{post.summary}</p>
      <p className="card-content">{post.content}</p>
      <div className="card-meta">
        {post.author && <span className="badge badge-assignee">By {post.author.name}</span>}
        <span className="badge">{new Date(post.createdAt).toLocaleDateString()}</span>
      </div>
    </div>
  );
}

function TutorialCard({ post }: { post: Tutorial }) {
  return (
    <div className="card card-tutorial">
      <div className="card-header">
        <span className="type-badge type-tutorial">Tutorial</span>
        <h3>{post.title}</h3>
      </div>
      <p className="card-content">{post.content}</p>
      <div className="card-meta">
        {post.author && <span className="badge badge-assignee">By {post.author.name}</span>}
        <span className="badge">{new Date(post.createdAt).toLocaleDateString()}</span>
        <span className="badge badge-difficulty">{post.difficulty}</span>
        <span className="badge badge-duration">{post.duration} min</span>
      </div>
    </div>
  );
}

function PostCard({ post }: { post: Post }) {
  switch (post.kind) {
    case 'article':
      return <ArticleCard post={post} />;
    case 'tutorial':
      return <TutorialCard post={post} />;
  }
}

export function PostList({ posts }: { posts: PostsResponse }) {
  const articles = posts.filter((p) => p.kind === 'article');
  const tutorials = posts.filter((p) => p.kind === 'tutorial');

  return (
    <div className="post-list">
      <h2>
        Posts ({posts.length}) — {articles.length} articles, {tutorials.length} tutorials
      </h2>
      <div className="cards">
        {posts.map((post) => (
          <PostCard key={post.id} post={post} />
        ))}
      </div>
    </div>
  );
}
