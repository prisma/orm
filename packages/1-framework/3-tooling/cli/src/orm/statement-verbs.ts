const verbs = {
  rename: {
    arity: 1,
    brief:
      'Rename a model or field instead of dropping it: old:new, each side Model, namespace.Model, Model.field or namespace.Model.field; repeat for several, applied in order',
  },
  delete: {
    arity: 1,
    brief:
      'Let the command lose the data of a model, field or storage name the refusal lists: --delete Model',
  },
  allow: {
    arity: 1,
    brief: "Let the command change who can read or write a model's data: --allow Model",
  },
  convert: {
    arity: 1,
    brief:
      'Convert the values of a field whose type changes with code you write into the migration: Model.field, named as the new contract names it',
  },
  backfill: {
    arity: 1,
    brief:
      'Fill a required field in existing rows with code you write into the migration: Model.field, new or made required',
  },
} as const;

/** The statement verbs `migration plan` declares: it writes a migration, so a convert or backfill has a file to fill. */
export const migrationPlanStatementVerbs = {
  rename: verbs.rename,
  delete: verbs.delete,
  convert: verbs.convert,
  backfill: verbs.backfill,
} as const;

/**
 * The statement verbs `db update` declares. It applies its plan directly, with no migration file to
 * fill, so it declares `convert` and `backfill` only to refuse them with a reason.
 */
export const dbUpdateStatementVerbs = {
  rename: verbs.rename,
  delete: verbs.delete,
  allow: verbs.allow,
  convert: {
    arity: 1,
    brief: 'Not available here: db update has no migration file to fill; use migration plan',
  },
  backfill: {
    arity: 1,
    brief: 'Not available here: db update has no migration file to fill; use migration plan',
  },
} as const;
