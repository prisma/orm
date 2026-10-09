/**
 * The statement verbs the ORM commands declare. Each command declares the verbs its questions
 * use: `migration plan` takes `rename` and `delete`, and `db update` also `allow`.
 */
export const ormStatementVerbs = {
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
    brief: 'Let the command widen who can read or write the rows of a model: --allow Model',
  },
} as const;
