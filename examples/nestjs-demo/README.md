# NestJS + Prisma 8 Demo

This example demonstrates the recommended Dependency Injection (DI) pattern for integrating Prisma 8 with NestJS.

## Key Patterns Demonstrated

1. **Value Provider DI**: The Prisma client instance is provided as a value using a `Symbol` token (`DB`), avoiding the need to extend `PrismaClient` or use legacy patterns like `$connect()`.
2. **Lazy Initialization**: Prisma 8's runtime client is lazy. It does not require an explicit `$connect()` on startup.
3. **Graceful Shutdown**: The `PrismaModule` implements `OnApplicationShutdown` to call `db.close()` exactly once when the application terminates. This requires `app.enableShutdownHooks()` in `main.ts`.
4. **Schema-Qualified Access**: Model access uses the Prisma 8 schema-qualified pattern (e.g., `db.orm.public.User`).
5. **Callback Transactions**: Transactions are handled via the callback form (`db.transaction(async (tx) => { ... })`).
6. **Testability**: The DI token can be easily overridden in tests using `.overrideProvider(DB).useValue(fakeDb)`.

## **Quickstart**

1. Copy the environment file:

   ```bash
   cp examples/nestjs-demo/.env.example examples/nestjs-demo/.env
   ```

2. Install dependencies (from the repository root):

   ```bash
   pnpm install
   ```

3. Initialize the database and emit the contract:

   ```bash
   pnpm --filter ./examples/nestjs-demo db:init
   pnpm --filter ./examples/nestjs-demo emit
   ```

4. Run the development server:

   ```bash
   pnpm --filter ./examples/nestjs-demo dev
   ```

5. Run tests to verify the DI override pattern:

   ```bash
   pnpm --filter ./examples/nestjs-demo test
   ```

6. Typecheck and lint:

   ```bash
   pnpm --filter ./examples/nestjs-demo typecheck
   pnpm --filter ./examples/nestjs-demo lint
   ```
