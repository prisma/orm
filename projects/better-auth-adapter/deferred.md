# Deferred work: Better Auth adapter

Each item says what it is, why it was left out, and what would bring it back.

- **`auth generate` edits the contract file in place.** Left out because no published API reads and writes PSL yet; that API is being decided separately. When it exists, `createSchema` parses the contract, appends missing models, inserts missing fields and formats, and refuses a TypeScript-authored contract with the printed text.
- **MySQL and MariaDB.** The adapter refuses them. Its pattern filters use `length()`, which counts bytes on MySQL, and MySQL's default collation ignores case, so case-sensitive filters would be wrong. Bring back when Prisma 8's MySQL support is past its early stage: fix the filters, run the conformance suites there.
- **MongoDB.** A separate ORM client, so a separate set of calls inside the same package. Better Auth's own MongoDB adapter covers those users meanwhile.
- **Native JSON and list columns.** The adapter stores Better Auth's `json`, `string[]` and `number[]` fields as text. An upgrader with `jsonb` or array columns must convert them. Native support would read the contract field's type and pass values through for those fields.
- **Hand-written atomic `consumeOne` and `incrementOne`.** The adapter relies on Better Auth's fallback (read, then a guarded delete or update). Native forms need the ORM client to delete one row and return it in one statement, and to update with an expression (`count = count + 1`).
- **Better Auth 1.8.** The peer range stops below it. On release: run the conformance suites against it, check `@better-auth/core/db/internal` still exports `registerSchemaCheck`, widen the range.
- **Telling Better Auth's maintainers.** When the pull request is open, the operator posts on better-auth/better-auth#9636.
- **Where the package lives long term.** It is developed in prisma/orm for now and is built to be moved.
- **An auth model whose primary key is not named `id`.** When such a model lacks an `id` field, the adapter prints `id String @id`, which gives the model two `@id` fields. Printing `@unique` in that case would fix it. Left out because Better Auth's own generators always make `id` the key, so the case needs a hand-written contract that departs from every generated one.
- **A test that installs the README's install command from a registry.** The packaging test declares the two Prisma platform packages directly, because the package manager otherwise takes them from the registry and not from the packed tarballs. Whether the README's line alone gives one copy can only be checked once the package is published.
- **A published way to read a target's default namespace and a codec's JavaScript type.** The adapter holds its own small tables of both. A public API would let it drop them.
