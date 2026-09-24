---
changes:
  - id: codec-without-params-has-no-params-schema
    summary: A codec that takes no params sets `paramsSchema` to `undefined`; `voidParamsSchema` is removed.
    detection:
      glob: "**/*.ts"
      contains:
        - "voidParamsSchema"
---

# A codec without params has no `paramsSchema`

`voidParamsSchema` is no longer exported from `@internal/framework-components/codec`. A codec descriptor that takes no params (`P = void`) sets `paramsSchema` to `undefined`, and `isParameterized` is `true` exactly when a descriptor has a `paramsSchema`. A codec without params still rejects any `typeParams` with `RUNTIME.TYPE_PARAMS_INVALID`.

In every file matched by `detection`:

```ts
// before
import { CodecDescriptorImpl, voidParamsSchema } from '@internal/framework-components/codec';
import type { StandardSchemaV1 } from '@standard-schema/spec';

class MyTextDescriptor extends CodecDescriptorImpl<void> {
  override readonly paramsSchema: StandardSchemaV1<void> = voidParamsSchema;
}

// after
import { CodecDescriptorImpl } from '@internal/framework-components/codec';

class MyTextDescriptor extends CodecDescriptorImpl<void> {
  override readonly paramsSchema = undefined;
}
```

- Remove `voidParamsSchema` from the import. Remove the `StandardSchemaV1` import too if nothing else in the file uses it.
- In a descriptor written as a plain object, replace `paramsSchema: voidParamsSchema` with `paramsSchema: undefined`.
- Code that reads `descriptor.paramsSchema` now sees `StandardSchemaV1<P> | undefined`. Check `descriptor.paramsSchema !== undefined` before calling its `validate`.

Parameterized codecs are unchanged.
