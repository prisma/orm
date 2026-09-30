# ADR 235 — The schema differ walks two derived schema IRs

Status: **Accepted**.

Related: [ADR 195 — Planner IR with two renderers](ADR%20195%20-%20Planner%20IR%20with%20two%20renderers.md), [ADR 224 — Control Policy](ADR%20224%20-%20Control%20Policy%20—%20framework-locked%20vocabulary%20and%20family-owned%20dispatch.md), [ADR 234 — Content-addressed wire names for Postgres-normalized objects](ADR%20234%20-%20Content-addressed%20wire%20names%20for%20Postgres-normalized%20objects.md).

## Decision

A schema diff is computed between two schema IRs of the same shape — an *expected* IR derived from a contract, and an *actual* IR derived by introspecting a live database. One generic differ, `diffSchemas(expected, actual)`, walks the two IRs as a tree and emits one issue per disagreement. The differ reads nothing but the two trees — no contract, no database catalog — and its code names no node type: everything it knows about a node comes through a four-member interface the node implements.

## A worked example

A contract declares an RLS policy on the `profile` table. The database has the table but not the policy. Each side derives to a schema-IR tree:

```
expected (from contract)              actual (from pg introspection)
database                              database
└─ namespace "public"                 └─ namespace "public"
   └─ table "profile"                    └─ table "profile"
      ├─ column "id"                        ├─ column "id"
      ├─ column "userId"                    └─ column "userId"
      └─ policy "profile_owner_read_a3f1c8b2"
```

The differ walks both trees together, pairing nodes level by level. Everything matches until the policy, which exists only on the expected side. One issue comes out:

```ts
{
  path: ['db', 'public', 'profile', 'profile_owner_read_a3f1c8b2'],
  expected: PostgresPolicySchemaNode { … }, // the IR node itself, on the expected side only
}
```

The issue carries no verdict of its own: the outcome it represents is a pure function of which sides are present. Only `expected` is here, so the node is missing from the database — **not-found**. `db verify` reports this issue as drift (severity graded by the table's control policy — [ADR 224](ADR%20224%20-%20Control%20Policy%20—%20framework-locked%20vocabulary%20and%20family-owned%20dispatch.md)). The migration planner maps the same issue to a `CREATE POLICY` operation. Both consumers read the one issue list; neither re-diffs anything.

## The node interface

Every schema element — namespace, table, column, primary key, foreign key, unique, index, check, policy — is a node implementing `DiffableNode` (`framework-components/src/control/schema-diff.ts`):

```ts
interface DiffableNode {
  readonly id: string;                       // a single path segment
  readonly nodeKind: string;                 // per-node discriminant; never folded into id
  readonly dependsOn?: readonly SchemaNodeRef[]; // nodes that must exist before this one
  isEqualTo(other: DiffableNode): boolean;   // compares a matched pair's OWN attributes only
  explainMismatch?(actual: DiffableNode | undefined): string | undefined; // optional; asked for not-equal and not-found
  children(): readonly DiffableNode[];       // the node's children; empty for a leaf
}
```

`dependsOn` names the node's structural prerequisites — a foreign key on its referenced table, a policy on its table and roles, a constraint on its own columns — as root-anchored `(nodeKind, id)` chains. Both derivations stamp it by the same rules; `isEqualTo` ignores it (a dependency change is always caused by a state change that already fires a difference).

The differ is given two corresponding nodes — at the top, the two database roots — compares them, and descends into their children. Because it takes a single node on each side (not a list), it diffs any two corresponding subtrees alike: two databases, or — below them — two tables. As it descends it accumulates each node's `id` into the **path** stamped on every issue, so an issue always says exactly where in the tree it sits.

An issue carries the failing node itself, typed:

```ts
interface SchemaDiffIssue<TNode extends DiffableNode = DiffableNode> {
  readonly path: readonly string[];
  readonly expected?: TNode;                       // absent when the node is not-expected
  readonly actual?: TNode;                         // absent when the node is not-found
  readonly dependsOn?: readonly (readonly string[])[]; // the paths of the in-diff issues this depends on
  readonly explanation?: string;                   // text for people from explainMismatch; never an outcome
}
```

The issue stores no separate kind field: the outcome it represents is discriminated by presence, read through the exported helper `issueOutcome(issue): 'not-found' | 'not-expected' | 'not-equal'`. The neutral expectation vocabulary reads cleanly from both perspectives — the planner's (create/drop/alter) and `db verify`'s (missing/extra/mismatch).

- **not-found** — `expected` only: in the desired tree, not in the current one (the worked example above).
- **not-expected** — `actual` only: in the current tree, not in the desired one (e.g. a live policy no contract declares).
- **not-equal** — both sides present: the two nodes pair up, but `isEqualTo` is false.

Caching the outcome as a stored `reason` alongside the very presence that determines it only invited the two to drift, so presence is the single source of truth. `dependsOn` is the issue-to-issue mirror of the node's own `dependsOn`: the differ resolves each node ref to the path of the in-diff issue at that coordinate, dropping any ref whose target produced no issue (that prerequisite is already satisfied by reality). The planner topologically sorts on these edges — a dependency's op before its dependent on the way up, after it on the way down.

An expected node may explain a not-equal or not-found outcome through `explainMismatch`, for example a contract default its data type refuses. The differ copies that text onto the issue as `explanation` and never reads it. It is text for people, not an outcome kind: the outcome still comes only from presence.

## How pairing works

Siblings pair by the combination of `nodeKind` and `id`, not by `id` alone. `id` needs only be unique among siblings of the *same kind* at a level (a genuine same-kind/same-id collision is an error). Two distinct kinds of child in the same slot list — say a role and a namespace — may legitimately share a name; they are never paired against each other, so the shared name is harmless. A node never encodes its kind into its `id` string to route around a collision; `nodeKind` is the discriminant that does that job.

Not every node is an entity with a contract-level coordinate. A column has no `EntityCoordinate`; its identity within the differ is its path. The differ is agnostic to entity coordinates entirely; it operates only on ids and paths.

Three more properties complete the walk's contract:

- **The differ is total.** An unmatched node emits its own issue and descends, emitting an issue for every node in the missing or extra subtree. Coalescing a parent change over its children is the planner's job, not the differ's.
- **`isEqualTo` compares own attributes only**, never children. The differ recurses, so child differences surface as their own issues at their own paths.
- **Ownership filtering is the caller's job.** In a database shared by several contract spaces, not-expected issues (actual-only) for entities a sibling space declares are dropped by the caller, consulting the contract-space aggregate's ownership capability. The differ itself compares everything it is handed.

## The tree has a real root

The top node of each IR is the **database** — a real node in the topology, since you connect to and migrate one database, not a synthetic wrapper fabricated to satisfy the differ. For Postgres the tree is:

```
database
├─ role …                    (cluster-scoped; attached to the root)
└─ namespace
   └─ table
      ├─ column (└─ default)
      ├─ primary key / foreign key / unique / index / check
      └─ policy
```

Roles are worth a note: they enter the diff existence-only. A declared role absent from `pg_roles` fails verify; an undeclared live role is tolerated; roles never produce migration operations — the system checks that platform-provided roles exist, it does not provision them.

## The two sides are derived IRs of one shape

A *derivation* turns a source into a schema IR. There are two of them:

- **project-from-contract** reads a contract into a schema IR.
- **project-from-database** introspects a live database into a schema IR.

They are peers and emit the same IR shape. A command wires one derivation to each side of the diff:

| Command | expected | actual |
| --- | --- | --- |
| apply a contract to a database | contract | database |
| verify a database against a contract | contract | database |
| generate a migration with no database in reach | contract | contract |

Because both sides are one shape no matter which derivation built them, a single comparison serves every command, and the planner that consumes the diff reads issues without asking where either side came from. A side's provenance lives in the command's choice of derivation — not in the differ, and not in the planner.

Derivation is also where **resolution** happens: each derivation populates every node in canonical form (resolved type names, normalized defaults, DDL-schema-resolved namespace ids), so `isEqualTo` is a plain structural comparison rather than a normalizing one. The differ interprets nothing.

One guarantee falls out of this and the differ relies on it: a node is only ever paired against a node of its own type. Both derivations build the IR in the same shape, so two nodes that pair by `(nodeKind, id)` are the same type, and `isEqualTo` can compare them as such.

## The tree structure serves the planner

The diff feeds the **planner** — `plan(start, end)`: two schema IRs in, the ordered list of migration operations out. The planner's needs are the reason the diff keeps its structure instead of flattening:

- It sequences operations by how nodes depend on one another: a table before the policies attached to it.
- It folds a paired drop-and-create of one logical object into a single rename — for a content-addressed node, a not-found/not-expected pair whose wire names share a hash suffix under different prefixes becomes one `ALTER POLICY … RENAME TO` ([ADR 234](ADR%20234%20-%20Content-addressed%20wire%20names%20for%20Postgres-normalized%20objects.md)). Name-identified indexes take the same pass into `ALTER INDEX … RENAME TO`, with a second content-pairing phase that converges an exact-named live index onto a wire-named contract name.
- It lets a change to a parent stand in for changes to its children.

Each of those is a relationship between nodes. The walk keeps those relationships in its output — every issue carries its path, and the nodes it hands back are the IR nodes with their references intact — so the planner reads each one straight from the diff.

## Responsibilities

- **The framework** owns the walk, the `(nodeKind, id)` pairing, the presence-derived `not-found | not-expected | not-equal` vocabulary (via `issueOutcome`), and the path. It names no node type.
- **A node** implements `id`, `nodeKind`, `isEqualTo()`, and `children()` in the package that defines it. A target-only node — an RLS policy, a role — implements them in the target package, the one place its type is named.
- **A derivation** builds one side's IR, populating every node that side carries in canonical form. A target's two derivations live with the target, written directly — not registered through a shared surface.

For a **content-addressed** node — an RLS policy — `id` settles equality on its own: the wire name encodes the body, so two policies that pair by id are equal by construction. `isEqualTo` carries the nodes whose id does not capture their whole content. Indexes are name-identified too (`SqlIndexIR`'s id is its full physical name), but their `isEqualTo` still compares structural attributes — and, for exact-named indexes, the opaque `expression`/`where` bodies byte-for-byte.

## Consequences

### Positive

- Adding a node type to the differ is local: implement the interface on the node and have the derivations populate it. The framework does not change.
- The walk handles a tree of any depth, so a nested node — a column within a table, a default within a column — needs no change to the differ.
- Policies on two tables with the same wire name (same prefix + identical body → same hash) never collide: each sits under a distinct table node with a distinct path.

### Negative

- A comparison of flat, independent entities would need neither a recursive walk nor a child interface; the differ carries both so that nested and dependent nodes cost nothing at its core.

## Alternatives considered

**Flatten both IRs to a node list, then diff the lists.** Collect every node from each IR into one flat list per side and pair the lists. Simple to write, and enough when the entities compared are flat and independent. Rejected because the input then has no structure at all: the planner's ordering, rename-coalescing, and parent-stands-for-child reasoning each need a relationship between nodes, and a flat diff would force every one of them to rebuild relationships the diff had thrown away.

**Diff a derived IR against a raw contract.** Build only the introspected side into a schema IR and compare it against the contract object directly. Rejected because the two are different shapes, so the comparison must special-case which side is which — and a command that has no live database to introspect, such as generating a migration offline, then has no IR on that side at all, and that node type is absent from that command entirely. Deriving both sides to one shape makes every command uniform.

**Register the derivations through a generic contribution surface.** Add a registry where a target contributes a node type's project-from-contract and project-from-database pair, dispatched generically. Rejected as scope: a registration surface designed around a single node type on a single target is designed against one example, which is guesswork. A target writes its derivations directly until a second consumer makes the shared shape concrete.

**Key nodes on `EntityCoordinate`.** Use the four-part `{plane, namespaceId, entityKind, entityName}` struct as the sibling key. Rejected on two grounds. Not all nodes are entities — a column has no `EntityCoordinate`. And a coordinate does not encode tree position: a policy's wire name is only unique per table, so two tables carrying an identically-named policy produce two nodes with one coordinate, which a coordinate-keyed differ must treat as a duplicate. Path-based ids avoid both by design: a node's identity within the differ is its position in the tree, not a struct reconstructed beside it.

**Fold a node's kind into its `id` string.** Have a node whose name could collide with a differently-typed sibling (a role named `public` colliding with a namespace named `public`) prefix a sigil onto its `id` so the two can never collide in the flat sibling map. Rejected: it leaks a differ-internal collision-avoidance detail into `id`, which is also the value stamped into every emitted issue's `path` — so the sigil leaks into paths and needs laundering wherever a path is turned into a message. The differ carries the discriminant itself: `nodeKind` joins `id` to key siblings, so `id` needs only be unique among siblings of the same kind, and a node never encodes its kind into its id string.

**A verdict tree instead of an issue list.** Have the diff return a pass/warn/fail tree mirroring the schema for the CLI to render. Rejected: verdict, formatting, and rendering are consumer concerns layered over the issue list (`db verify` derives its verdict from "is the filtered issue list empty"), and a tree output forces every non-CLI consumer (planner, runner post-apply check) to walk presentation structure to get at the differences.
