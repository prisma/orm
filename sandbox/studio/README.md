# Studio CLI Test Package

Temporary package for testing the new `prisma studio` CLI command.

## Setup

1. Install dependencies:
   ```bash
   pnpm install
   ```

2. Create a `.env` file from the example:
   ```bash
   cp .env.example .env
   ```

3. Add your PostgreSQL connection string to `.env`:
   ```
   DATABASE_URL=postgresql://user:password@host:port/database
   ```

## Testing

Run the Studio command:
```bash
pnpm studio
```

Or with debug mode:
```bash
pnpm studio:debug
```

## Expected Output

The command should:
1. Connect to your PostgreSQL database via the adapter
2. Introspect the database schema
3. Output JSON with table/column information
4. Return "ok!"

## Cleanup

To remove this test package:
```bash
rm -rf sandbox/studio-test
```
