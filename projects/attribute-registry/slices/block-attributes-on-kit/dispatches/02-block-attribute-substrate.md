# Dispatch 2 — block-attribute-substrate

Slice plan: `../plan.md` § Dispatch 2. Spec: `../spec.md` § Chosen design 2.

## Task

Add the erased `attributes` key to `AuthoringPslBlockDescriptor`, the required `attributes` record (+ `PslExtensionBlockParsedAttribute`) to `PslExtensionBlock`, and `PSL_EXTENSION_UNKNOWN_BLOCK_ATTRIBUTE` to the framework code set; adapt every in-repo block-node constructor — such that the node is total (consumers read `block.attributes` without an existence check) and core never names `AttributeSpec`.

## Completed when

- [ ] `psl-block-descriptor.types.test.ts` pins the optional erased `attributes` key and the required node field.
- [ ] `control-stack.test.ts`: a descriptor with `attributes` assembles and keeps the key; a non-object `attributes` is rejected as malformed.
- [ ] Every `blockAttributes:` literal site also carries `attributes:` (grep counts equal); psl-infer builders synthesise the parsed `map` entry.
- [ ] Gates: framework-components build → workspace typecheck; framework-components lint/test; target-postgres test; lint:deps.

## Edge cases

| Case | Disposition |
| --- | --- |
| F5 destructive git | forbidden |
| F3 broken constructors | `rg 'blockAttributes:'` enumerates them; workspace typecheck confirms |
| F16 layering comment | HALT |
| No code comments | none added; no doc bullets added either |
