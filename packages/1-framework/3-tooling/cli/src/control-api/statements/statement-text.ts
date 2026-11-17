/** The verbs a statement can have. */
export type StatementVerb = 'rename' | 'delete' | 'allow' | 'convert' | 'backfill';

/** A verb whose statement the plan carries out, rather than one that consents to what it does. */
export type PlannedStatementVerb = 'rename' | 'convert' | 'backfill';

/**
 * A statement as the user wrote it, before it is parsed: its verb and its text, for example
 * `{ verb: 'rename', text: 'Profile:User' }` for `--rename Profile:User` or
 * `{ verb: 'delete', text: 'Legacy' }` for `--delete Legacy`.
 */
export interface StatementText {
  readonly verb: StatementVerb;
  readonly text: string;
}

/** The `--rename` texts a command was given, as statements, in the order given. */
export function renameStatements(texts: readonly string[] | undefined): readonly StatementText[] {
  return (texts ?? []).map((text) => ({ verb: 'rename', text }));
}

const STATEMENT_VERBS: readonly string[] = [
  'rename',
  'delete',
  'allow',
  'convert',
  'backfill',
] satisfies readonly StatementVerb[];

export function isStatementVerb(verb: string): verb is StatementVerb {
  return STATEMENT_VERBS.includes(verb);
}

export function isPlannedStatement(
  statement: StatementText,
): statement is StatementText & { readonly verb: PlannedStatementVerb } {
  return (
    statement.verb === 'rename' || statement.verb === 'convert' || statement.verb === 'backfill'
  );
}

/** The field a `convert` and a `delete` of the same run both name, which conflict; `undefined` when none does. */
export function convertAndDelete(statements: readonly StatementText[]): string | undefined {
  const deleted = new Set(
    statements.filter(({ verb }) => verb === 'delete').map(({ text }) => text),
  );
  return statements.find(({ verb, text }) => verb === 'convert' && deleted.has(text))?.text;
}

/** Each kind of thing a statement or a question can name, as messages write it. */
export const ENTITY_WORDS: Readonly<
  Record<'model' | 'field' | 'enumValue' | 'valueObjectField' | 'storage', string>
> = {
  model: 'model',
  field: 'field',
  enumValue: 'enum value',
  valueObjectField: 'value object field',
  storage: 'storage',
};
