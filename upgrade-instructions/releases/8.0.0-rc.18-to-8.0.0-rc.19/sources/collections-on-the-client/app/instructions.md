---
changes:
  - id: collections-on-the-client
    summary: |
      Not a breaking change. Every SQL client takes your custom collection classes as an option, `collections`, and uses them on `db.orm`, on the ORM of every transaction (`tx.orm`), on every connection a serverless client opens, and on every Supabase role-bound client: `postgres({ contract, url, collections: { Post: PostCollection } })`, then `db.orm.public.Post.published()`. Code that builds its own ORM client with `orm({ runtime, context, collections })` to reach its classes still works; replace it with the option and use the client's ORM. The detection matches a call to `orm({ ... })`, or to `orm` imported under another name, that passes `collections`.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '(?<![\w$.])orm\s*(?:<[^>()]*(?:<[^>()]*>[^>()]*)*>)?\(\s*\{(?:(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*?,)?\s*collections\s*[,}:]'
        - 'import\s*\{[^}]*\borm\s+as\s+([\w$]+)[^}]*\}\s*from\s*[''\"][^''\"]+[''\"][\s\S]*(?<![\w$.])\1\s*(?:<[^>()]*(?:<[^>()]*>[^>()]*)*>)?\(\s*\{(?:(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*?,)?\s*collections\s*[,}:]'
---

# Custom collection classes go on the client

`postgres()`, `postgresServerless()`, `sqlite()` and `supabase()` take an option, `collections`, with the same type `orm({ collections })` takes. The client types are inferred from it, and the classes reach every ORM the client offers:

```ts
// Before
import { orm } from '@prisma/orm-postgres/orm-client';
import { db } from './prisma/db';

export const posts = orm({
  runtime: db.runtime(),
  context: db.context,
  collections: { Post: PostCollection },
}).public.Post;

// After, in the module that creates the client
export const db = postgres({ contract, url, collections: { Post: PostCollection } });

await db.orm.public.Post.published().all();
await db.transaction(async (tx) => tx.orm.public.Post.published().forUpdate().all());
```

1. Pass the classes as `collections` where the client is created. If the module that defines the classes imports the client's module, import only the `Contract` type there (`import type { Contract } from './contract.d'`), so the two modules do not import each other.
2. Delete the hand-built ORM client (for example a `createOrmClient(runtime)` helper) and every `orm({ runtime, context, collections })` that only existed to reach the classes. Use `db.orm` instead. On SQLite, `db.orm` is the model collections themselves: `db.orm.Post`.
3. A function that took a `runtime` only to build an ORM no longer needs it. Inside a transaction, pass `tx.orm`, which has the classes too.
4. On a serverless client, the classes are on every connection: `await using db = await postgres.connect({ url }); db.orm.public.Post.published()`.
5. On Supabase, the classes are on `asUser`, `asAnon` and `asServiceRole` clients. Supabase's internal `.supabase` ORM does not take them.

A type written with only the contract, such as `PostgresClient<Contract>`, still describes a client without classes and accepts a client created with them. To name a client with classes, give the second type parameter: `PostgresClient<Contract, { Post: typeof PostCollection }>`.
