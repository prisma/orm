# @prisma/param-graph-builder

This package is intended for Prisma's internal use.

Builds a ParamGraph from DMMF (Data Model Metadata Format) at client generation time.

The ParamGraph is a compact data structure that enables schema-aware parameterization at runtime. It stores only parameterizable paths and uses a string table to de-duplicate field names.

This package is used by both `@prisma/client-generator-js` and `@prisma/client-generator-ts` to generate the parameterization schema that is embedded in the generated Prisma Client.
