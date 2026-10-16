# Deferred work: runtime activity tree

Gaps found while building the project that are outside its scope. Each existed before the project started.

- **Stream in-flight tracking ends before the statement's hooks.** `SqlRuntimeBase` ends a query's in-flight record when the driver answers (`onDriverAnswered`), before `activityEnded` and `activityFinalized` run. A `close()` with `closeRefusal: 'when-idle'` can therefore close the driver while those hooks run. On main the same held for `afterQuery`.
- **A dropped iterator never ends its statement.** A caller that reads the first row and drops the iterator without calling `return()` leaves the statement open: no `activityEnded`, and outside a transaction no `activityFinalized`.
- **`intercept.onQuery` and `intercept.onExecute` are not raced against the abort signal**, unlike `beforeEncode`.
- **A queryable without an activity source fails with a bare invariant.** `startActivityOn` and `planContentHashOn` throw "The queryable cannot start activities" from `invariant` when the queryable has no `activitySource` member. Now that both are public, a third-party caller reaches this through its own mistake (a stub, a facade without the member, or a second copy of the package with its own symbol), so a coded runtime error would explain it better.
- **Two public-shell checks have no test.** That the `activitySource` symbol is the same object in `@prisma/orm-postgres/family-runtime` and `@prisma/orm-family-sql/runtime`, and that augmenting `ClientActivityRegistry` through `@prisma/orm-postgres/components/runtime` types a handle. The cross-shell tarball test does not install `@prisma/orm-postgres`, and that package has no test setup. Manual QA of slice 2 checked the augmentation by hand.
