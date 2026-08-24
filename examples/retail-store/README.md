# Retail Store — Prisma Next MongoDB Example

An interactive e-commerce example application demonstrating Prisma Next's MongoDB capabilities with a Next.js frontend.

## What This Demonstrates

| Feature | Implementation |
| --- | --- |
| **PSL contract with embedded value objects** | 8 `type` definitions (Price, Image, Address, CartItem, etc.) nested inside 7 models |
| **ORM CRUD** | `create`, `createAll`, `update`, `delete`, `upsert` via `@internal/mongo-orm` |
| **Reference relations** | `include('user')` compiles to `$lookup` for cart→user, order→user, invoice→order |
| **Array update operators** | `$push`/`$pull` via `mongoRaw` for cart items and order status history |
| **Aggregation pipelines** | `$match`→`$group`→`$sort` for event analytics, `$sample` for random products |
| **Pipeline search** | `$regex` via `MongoOrExpr` + `MongoFieldFilter.of` for multi-field text search |
| **Pagination** | Mongo query-builder `.skip(n).limit(n)` for paginated product listing |
| **Vector search** | `findSimilarProducts` via `$vectorSearch` (requires Atlas cluster) |
| **Cookie-based auth** | Next.js middleware + signup/logout API routes with `userId` cookie |
| **Interactive cart** | Add to Cart, remove, clear — all backed by PN data layer + CartProvider context |
| **Checkout flow** | Home delivery vs BOPIS (Buy Online, Pick Up In Store) with location picker |
| **Order lifecycle** | Status progression (placed → shipped → delivered) via `$push` status entries |
| **Next.js integration** | Server-rendered pages, client components, REST API routes, Tailwind CSS v4 |

## Quick Start (tests only — no external DB)

```bash
# 1. Build framework packages (from repo root)
pnpm build

# 2. Emit contract
pnpm emit

# 3. Run tests (uses mongodb-memory-server)
pnpm test
```

## Running with a Remote MongoDB Instance

To run the full app (UI + API) against a real MongoDB cluster:

**1. Create `.env` in `examples/retail-store/`:**

```env
DB_URL=mongodb+srv://user:pass@your-cluster.mongodb.net
MONGODB_DB=retail-store
```

**2. Seed the database:**

```bash
pnpm db:seed
```

This populates all 7 collections with 24 products across 5 brands, 4 store locations, and sample users/orders/events.

**3. Start the dev server:**

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). You'll be redirected to the login page — click "Sign Up" to create a user and start browsing.

### User Flow

1. **Sign Up** → creates a user doc via ORM, sets `userId` cookie
2. **Browse** → paginated product catalog (8 per page), search bar
3. **Add to Cart** → click on a product, "Add to Cart" button
4. **Cart** → view items, remove individual items, clear cart
5. **Checkout** → choose home delivery or store pickup, place order
6. **Orders** → view order history, advance status (placed → shipped → delivered)
7. **Log Out** → clears cookie, redirects to sign-up

### Vector Search (optional, Atlas only)

To test `findSimilarProducts`, create a vector search index named `product_embedding_index` on the `products` collection's `embedding` field in Atlas, and populate the `embedding` arrays with actual vectors (the seed data sets `embedding: null` by default).

## Domain Model

```text
Products  ─── Price, Image (embedded value objects)
Users     ─── Address? (optional embedded)
Carts     ──→ User (reference relation), CartItem[] (embedded array)
Orders    ──→ User (reference relation), OrderLineItem[], StatusEntry[]
Locations ─── flat fields
Invoices  ──→ Order (reference relation), InvoiceLineItem[]
Events    ─── polymorphic (@@discriminator on type)
              ├── ViewProductEvent  (productId, subCategory, brand)
              ├── SearchEvent       (query)
              └── AddToCartEvent    (productId, brand)
```

## Project Structure

```text
prisma/contract.prisma    PSL schema with types and models
src/contract.json         Generated contract (machine-readable)
src/contract.d.ts         Generated types (compile-time safety)
src/db.ts                 Database factory (orm, runtime, pipeline, raw)
src/seed.ts               Seed data for all 7 collections
src/data/                 Data access layer (typed functions per collection)
src/lib/auth.ts           Server-side auth helper (cookie-based)
src/lib/utils.ts          cn() utility for Tailwind class merging
src/components/           Navbar, CartProvider, AddToCartButton, UI primitives
test/                     Integration tests against mongodb-memory-server
app/                      Next.js App Router (pages + API routes)
middleware.ts             Auth middleware (redirects to /login)
```

## Framework Gaps

- **ObjectId in filters**: `MongoFieldFilter.eq` with ObjectId values requires wrapping in `MongoParamRef` (see `src/data/object-id-filter.ts`)
- **Schema migrations**: Migration artifacts are committed under `migrations/`; run `pnpm migration:apply` to apply. The planner handles indexes and collection validators but not all schema-level operations.
- **Typed `$push`/`$pull`**: ORM doesn't expose array update operators; use `mongoRaw` with untyped commands
- **Pipeline output types**: The pipeline builder doesn't propagate output types through aggregation stages; results are cast to expected shapes at the call site
- **Atlas Search**: Requires extension pack not yet available
- **Change Streams**: Not yet supported in the framework
