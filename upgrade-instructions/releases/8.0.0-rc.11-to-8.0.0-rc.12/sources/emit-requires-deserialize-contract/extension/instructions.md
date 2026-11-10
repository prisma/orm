---
changes:
  - id: emit-requires-deserialize-contract
    summary: Pass the contract family's deserializer to emit(); contract.d.ts is now always generated from the canonical contract.json.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - 'import\s*\{[^}]*\bemit\b[^}]*\}\s*from\s*[^/\w\s]@(?:prisma/orm-toolchain|internal)/emitter[^/\w-]'
---

## `emit-requires-deserialize-contract`

Find calls to `emit(contract, stack, emission, options)` imported from `@prisma/orm-toolchain/emitter`. Add a `deserializeContract` option that reads the canonical JSON object back into a contract through the family instance of the contract being emitted:

```ts
const familyInstance = family.create(stack);
const result = await emit(contract, stack, family.emission, {
  serializeContract: (c) => target.contractSerializer.serializeContract(c),
  deserializeContract: (json) => familyInstance.deserializeContract(json),
});
```

`emit()` generates `contract.d.ts` from that re-read contract, so models, fields and relations appear in the order `contract.json` lists them. Use the family's own deserializer rather than an identity function: the family builds the objects the declaration generator reads. Direct calls to `generateContractDts` are unchanged.
