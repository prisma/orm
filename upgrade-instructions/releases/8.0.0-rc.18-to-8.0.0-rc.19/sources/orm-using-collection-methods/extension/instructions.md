---
changes:
  - id: aggregate-operation-using-reserved
    summary: |
      Every ORM collection has a `using` member, so `orm()` refuses a contributed aggregate operation named `using` with `ORM.AGGREGATE_OPERATION_RESERVED`, as it refuses `with` and `fragment`. An extension that contributes an aggregate operation named `using` renames it. The detection matches a file that names an aggregate operation `using`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\boperation\s*:\s*[''"`]using[''"`]'
---

# An aggregate operation cannot be named `using`

A collection's `using` member holds the collection methods that packages contribute for the model. Aggregate operations become reducer methods on the same collection, so a contributed aggregate operation named `using` would collide with it. `orm()` refuses such an operation when the client is built, with `ORM.AGGREGATE_OPERATION_RESERVED`. Rename the operation in the extension's aggregate descriptors, and in the operation types the extension's contracts reference.
