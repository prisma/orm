---
changes:
  - id: removed-namespace-questions
    summary: |
      On Postgres, when the contract no longer declares a namespace the database's contract declared, `migration plan` and `db update` plan to drop its tables, asking about each model, and then the schema. Before, those tables were left in place without a word. If the namespace was renamed, say so with `--rename <old namespace>:<new namespace>`, which renames the schema and keeps every row. Answer with `--delete <namespace>` to let the tables go, or keep a model by moving it with `--rename <namespace>.<Model>:<other namespace>.<Model>`.
---

# A removed namespace is asked about

If your contract removes a `namespace` block on Postgres, the next `migration plan` or `db update` asks about each model that namespace held, as it asks about any model you remove.

If you renamed the block, for example from `billing` to `finance`, give the rename and nothing is dropped:

```bash
prisma db update --rename billing:finance
```

Otherwise the namespace is removed. A script that runs without a terminal fails with `CLI.CONSENT_REQUIRED`, listing each model. To drop them all and the schema, add `--delete <namespace>`:

```bash
prisma db update --delete billing
```

To keep a model's data, move it to a namespace the contract keeps in the same run, for example `--rename billing.Invoice:public.Invoice`, or put the namespace back in the contract.

A table in that schema that no contract declared, such as one created by hand, is asked about too, by its storage name: `--delete billing.audit_log`. `--delete billing` does not answer it. Another object no contract declared, such as a view or a function, makes the run fail and changes nothing: a view on one of the tables stops that table's drop, and any other object stops the schema drop. The failure names each object; drop or move it yourself, then run the command again.

A namespace that only another contract space declares, and a schema no contract ever declared, such as Supabase's `auth`, are still left alone.
