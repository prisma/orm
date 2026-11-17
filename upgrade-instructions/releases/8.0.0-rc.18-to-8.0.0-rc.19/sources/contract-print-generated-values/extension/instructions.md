---
changes:
  - id: print-generated-values-through-generator-functions
    summary: |
      `contract print` writes generated values as `@onCreate(fn())` and `@onUpdate(fn())` through the generator functions the stack binds to the column's codec. The `printArguments` field of a default function and the field preset print forms that this note described were removed before release. Follow `default-generators-to-on-create` for extension authors instead.
---

# `contract print` writes generated values through generator functions

This note is replaced by `default-generators-to-on-create` for extension authors. Do what that note says. Do not add `printArguments` to a default function: the field no longer exists.
