---
changes:
  - id: share-create-default-cache-across-inserts
    summary: Share query-stable mutation defaults across every insert in one logical create operation.
---

# Share create-default caches across physical inserts

If an extension orchestrates multiple `applyMutationDefaults` calls for one logical create, allocate one `Map<string, unknown>` before iterating its rows and pass it as `defaultValueCache` to every call. For multi-table inheritance, pass the same cache to both the base-table and variant-table inserts, including all rows of a bulk create.

Let helpers that apply create defaults accept that cache from their caller, with a fresh map as the default for standalone operations. Do not keep it on a reusable collection, runtime, or transaction: a subsequent create operation needs a fresh cache.

Continue letting the mutation-default registry honor generator stability. Do not cache field-stable generators yourself; generated IDs must remain independent.
