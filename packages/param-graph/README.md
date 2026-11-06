# @prisma/param-graph

This package is intended for Prisma's internal use.

Contains the ParamGraph types and utilities for schema-aware query parameterization in Prisma Client.

ParamGraph is a compact data structure generated from DMMF (Data Model Metadata Format) at client generation time. It enables precise, schema-driven parameterization of query values at runtime.

## Contents

- `ParamGraph` - The main type representing the compact schema
- `InputNode` / `OutputNode` - Node types for input arguments and output selections
- `InputEdge` / `OutputEdge` - Edge types describing field capabilities
- `EdgeFlag` - Bit flags for input field capabilities
- `ScalarMask` - Bit mask for scalar type categories
- `scalarTypeToMask` - Maps DMMF scalar type names to mask values
- `hasFlag` / `getScalarMask` - Helper functions for edge inspection

## Repeated deserialization

`ParamGraph.deserialize` shares decoded data for the same immutable serialized schema object. Each call creates a separate wrapper with its own enum lookup and string index. Different schema objects have separate cache entries, and the weak cache does not keep discarded schema objects alive.

To measure repeated construction with a synthetic graph and no database, run from the repository root:

```sh
node --expose-gc --import tsx packages/param-graph/helpers/benchmark-deserialization.ts 32 4096
```

The arguments are the number of live instances and the number of input/output nodes. The output reports the first construction separately from subsequent constructions and their additional retained heap after garbage collection. Run the same script before and after a change to compare results. The first decode still has to construct the full graph.
