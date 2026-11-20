# `@prisma/client-runtime-utils`

This package provides utility types and singleton instances used by the Prisma Client.
These are reexported by the generated clients but can also be directly imported from here.
This is useful for cases where one does not want to depend on a specific generated Prisma Client.

Example usage:

```
import { PrismaClientKnownRequestError, DbNull, Decimal } from '@prisma/client-runtime-utils'
```
