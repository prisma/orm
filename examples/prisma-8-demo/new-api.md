# New API sketches

## Collection-based client structure

```typescript
class PostCollection extends Collection<Contract, "Post"> {
  popular() {
    return this.where((p) => p.views.gt(1000));
  }
}

// ...

const db = postgres({
  contract,
  url,
  collections: {
    Post: PostCollection,
    // Use default collections for the rest of the model
  }
});
const orm = db.orm.public;

const posts = await orm.Post.popular().all().toArray()

// A transaction's ORM has the same classes
const locked = await db.transaction(async (tx) =>
  tx.orm.public.Post.popular().forUpdate().all()
)
```

## Filter parent records by child records

```typescript
const users = await orm
  .User
  .where((u) => u.posts.some((p) => p.popular()))
  .all()
  .toArray()
```

## Selecting related records

```typescript
orm
  .User
  .where(conditions)
  .include('posts', (p) =>
    p.where(conditions).include('comments')
  )
  .all()
```

## Nested mutation

We're not awaiting `first()`, instead using `.comments` to drop to a `comments` collection attached to the parent `post` record.

```typescript
 orm
  .Post
  .where({ id: postId })
  .first()
  .comments
  .create(commentInput)
```


## Prev iterations, rejected for now


```typescript
const users = await db
  .user
  .where(/* ... */)
  // option 1
  .select((u) => ({
    name: u.name,
    // posts: u.posts.filter((p) => p.views.gt(1000))
    posts: u.posts.select((p) => ({
      title: p.title,
      comments: p.comments,
    }))
  }))
  // option 2
  .select({
    name: true,
    posts: {
      comments: true
    }
  })
  .all()
  .toArray()
```


## Questions

1. Including the low level queries into the high level query
2. Database capabilities and the number of queries
3. Fluent API for operators: looks nice but hard to extend. Functions are more composable.
