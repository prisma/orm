# ADR 293 — Validations, soft delete and lifecycle hooks are not in the core

**Status:** Accepted
**Date:** 2026-10-22
**Builds on:** [ADR 259 — Query fragments are functions](ADR%20259%20-%20Query%20fragments%20are%20functions.md), [ADR 271 — The runtime middleware observes a tree of activities, each started, ended and finalized](ADR%20271%20-%20The%20runtime%20middleware%20observes%20a%20tree%20of%20activities,%20each%20started,%20ended%20and%20finalized.md)

---

## Decision

Never in the core. An extension or user code may provide any of them. Use instead:

- Validations: validate in application code, for example with arktype.
- Soft delete: a nullable `deletedAt` column and a scope that hides deleted rows, applied with `with` ([ADR 259](ADR%20259%20-%20Query%20fragments%20are%20functions.md) shows this as `notDeleted`).
- Lifecycle hooks: middleware on the runtime's lifecycle events ([ADR 271](ADR%20271%20-%20The%20runtime%20middleware%20observes%20a%20tree%20of%20activities,%20each%20started,%20ended%20and%20finalized.md)), or application code.

## Context

ActiveRecord-style ORMs, such as Rails' Active Record or Sequelize, build these into their models: validation rules declared on a model, soft delete such as Sequelize's `paranoid: true`, and hooks such as `beforeSave` or `afterCreate`. Will Madden, 2026-10-22: "validations are achievable in user space" and "soft delete should be achievable in extension/user space". In the same message: "we will not build in the core features which can be built in extension/user space." The [GA plan](https://github.com/prisma/orm/blob/196fa9e57c53befd65b8f75724aaa660ec480de3/planning/plan.md?plain=1#L150-L152) lists "soft delete, validation rules, lifecycle hooks" under Never.

## Consequences

An extension may offer any of them, built on the [public SPI](../../../README.md#for-extension-authors). No revisit-if condition is recorded.
