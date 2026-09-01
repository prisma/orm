# Native Generated Columns Support in Prisma

This example demonstrates Prisma's native support for database-level computed/generated columns.

> **✨ New Feature:** Prisma now automatically generates `GENERATED ALWAYS AS` SQL for fields marked with the `@generatedColumn` comment syntax!

## What's New?

Instead of manually editing migration files, you can now define generated columns directly in your Prisma schema using a special comment syntax. Prisma will automatically generate the correct database-specific SQL.

## Quick Start

### 1. Define Generated Columns in Your Schema

```prisma
model User {
  id          String @id @default(cuid())
  firstName   String
  lastName    String

  /// @generatedColumn firstName || ' ' || lastName
  fullName    String @default(dbgenerated())
}
```

### 2. Run Migration

```bash
npx prisma migrate dev --name add_generated_columns
```

Prisma will automatically generate SQL like:

**PostgreSQL:**

```sql
ALTER TABLE "User" ADD COLUMN "fullName" TEXT GENERATED ALWAYS AS (firstName || ' ' || lastName) STORED;
```

**MySQL:**

```sql
ALTER TABLE `User` ADD COLUMN `fullName` VARCHAR(255) GENERATED ALWAYS AS (CONCAT(firstName, ' ', lastName)) STORED;
```

**SQLite:**

```sql
ALTER TABLE "User" ADD COLUMN "fullName" TEXT GENERATED ALWAYS AS (firstName || ' ' || lastName) STORED;
```

### 3. Use in Your Code

```typescript
const user = await prisma.user.create({
  data: {
    firstName: 'John',
    lastName: 'Doe',
  },
})

console.log(user.fullName) // "John Doe" - automatically computed!
```

## Running This Example

1. **Install dependencies:**

   ```bash
   npm install
   ```

2. **Set up the database:**

   ```bash
   export DATABASE_URL="file:./dev.db"
   npx prisma migrate dev
   ```

3. **Run the demo:**
   ```bash
   npm run dev
   ```

## Syntax

The generated column syntax consists of two parts:

1. **Comment marker:** `/// @generatedColumn EXPRESSION`
2. **Field attribute:** `@default(dbgenerated())`

```prisma
/// @generatedColumn <database expression>
fieldName Type @default(dbgenerated())
```

## Complete Examples

### Example 1: Full Name Concatenation

```prisma
model User {
  id        String @id @default(cuid())
  firstName String
  lastName  String

  /// @generatedColumn firstName || ' ' || lastName
  fullName  String @default(dbgenerated())
}
```

### Example 2: Phone Number Formatting

```prisma
model User {
  countryCode String
  phone       String

  /// @generatedColumn countryCode || ' ' || phone
  formattedPhone String @default(dbgenerated())
}
```

### Example 3: Email Domain Extraction

**SQLite:**

```prisma
model User {
  email String @unique

  /// @generatedColumn substr(email, instr(email, '@') + 1)
  emailDomain String @default(dbgenerated())
}
```

**PostgreSQL:**

```prisma
model User {
  email String @unique

  /// @generatedColumn SUBSTRING(email FROM POSITION('@' IN email) + 1)
  emailDomain String @default(dbgenerated())
}
```

### Example 4: Price Calculations

```prisma
model Product {
  basePrice  Decimal
  taxRate    Decimal @default(0.0825)

  /// @generatedColumn basePrice * (1 + taxRate)
  totalPrice Decimal @default(dbgenerated())
}
```

## Database-Specific Expressions

Different databases have different SQL syntax. Write your expressions using your database's syntax:

### String Concatenation

| Database   | Syntax                             |
| ---------- | ---------------------------------- |
| PostgreSQL | `firstName \|\| ' ' \|\| lastName` |
| MySQL      | `CONCAT(firstName, ' ', lastName)` |
| SQLite     | `firstName \|\| ' ' \|\| lastName` |

### Substring/String Functions

| Database   | Extract after '@'                                  |
| ---------- | -------------------------------------------------- |
| PostgreSQL | `SUBSTRING(email FROM POSITION('@' IN email) + 1)` |
| MySQL      | `SUBSTRING(email, LOCATE('@', email) + 1)`         |
| SQLite     | `substr(email, instr(email, '@') + 1)`             |

## How It Works

1. **Schema Parsing:** Prisma scans your schema for `/// @generatedColumn` comments
2. **Expression Extraction:** The expression is extracted from the comment
3. **SQL Generation:** When creating migrations, Prisma transforms the column definition
4. **Database-Specific:** The correct `GENERATED ALWAYS AS` syntax is used for your database

## Benefits

✅ **No manual migration editing** - Prisma handles it automatically  
✅ **Database-agnostic** - Works with PostgreSQL, MySQL, and SQLite  
✅ **Type-safe** - Full TypeScript support  
✅ **Automatic computation** - Database calculates values on insert/update  
✅ **Queryable** - Use generated columns in WHERE clauses  
✅ **Indexable** - Create indexes on generated columns for performance

## Limitations

1. **Expression syntax:** Must use your database's SQL syntax
2. **Same-row only:** Can only reference columns in the same row
3. **Read-only:** Cannot directly set values for generated columns
4. **STORED only:** Currently generates STORED columns (not VIRTUAL)

## Best Practices

### 1. Keep Expressions Simple

```prisma
// ✅ Good - simple concatenation
/// @generatedColumn firstName || ' ' || lastName
fullName String @default(dbgenerated())

// ⚠️ Avoid - complex nested expressions
/// @generatedColumn CASE WHEN age > 18 THEN 'Adult' ELSE 'Minor' END
ageGroup String @default(dbgenerated())
```

### 2. Add Indexes for Frequently Queried Columns

After generating the migration, you can add indexes:

```sql
CREATE INDEX "User_fullName_idx" ON "User"("fullName");
```

Or in your schema:

```prisma
/// @generatedColumn firstName || ' ' || lastName
fullName String @default(dbgenerated())

@@index([fullName])
```

### 3. Document Your Expressions

```prisma
// Combines first and last name for full-text search
/// @generatedColumn firstName || ' ' || lastName
fullName String @default(dbgenerated())
```

### 4. Test Expressions in Your Database First

Before adding to your schema, test the expression in your database:

```sql
-- PostgreSQL
SELECT firstName || ' ' || lastName AS fullName FROM "User";

-- MySQL
SELECT CONCAT(firstName, ' ', lastName) AS fullName FROM User;
```

## Migration from Manual Approach

If you were previously using manual migration editing, you can migrate to the new syntax:

**Before (Manual):**

```prisma
model User {
  firstName String
  lastName  String
  fullName  String?  // Manually added in migration
}
```

**After (Automatic):**

```prisma
model User {
  firstName String
  lastName  String

  /// @generatedColumn firstName || ' ' || lastName
  fullName  String @default(dbgenerated())
}
```

Then run:

```bash
npx prisma migrate dev --name use_native_generated_columns
```

## TypeScript Types

Generated columns are automatically included in your Prisma Client types:

```typescript
// ✅ Can read
const fullName = user.fullName

// ❌ Cannot write (database will reject)
await prisma.user.create({
  data: {
    firstName: 'John',
    lastName: 'Doe',
    fullName: 'Manual Value', // Database error!
  },
})
```

## Troubleshooting

### Expression Syntax Errors

If your migration fails, check that your expression uses valid SQL for your database:

```bash
# Test in PostgreSQL
psql -d mydb -c "SELECT firstName || ' ' || lastName FROM \"User\" LIMIT 1;"

# Test in MySQL
mysql -u root -p -e "SELECT CONCAT(firstName, ' ', lastName) FROM User LIMIT 1;"
```

### Column Type Mismatch

Ensure the Prisma type matches the expression result:

```prisma
// ✅ Correct - concatenation returns String
/// @generatedColumn firstName || ' ' || lastName
fullName String @default(dbgenerated())

// ❌ Wrong - concatenation doesn't return Int
/// @generatedColumn firstName || ' ' || lastName
fullName Int @default(dbgenerated())
```

## Additional Resources

- [PostgreSQL Generated Columns](https://www.postgresql.org/docs/current/ddl-generated-columns.html)
- [MySQL Generated Columns](https://dev.mysql.com/doc/refman/8.0/en/create-table-generated-columns.html)
- [SQLite Generated Columns](https://www.sqlite.org/gencol.html)
- [Prisma Schema Reference](https://www.prisma.io/docs/orm/reference/prisma-schema-reference)

## Related Issues

- [#28378 - Not able to create Computed fields in the schema file](https://github.com/prisma/prisma/issues/28378)
