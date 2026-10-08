/** The verbs a statement can have. */
export type StatementVerb = 'rename';

/**
 * A statement as the user wrote it, before it is parsed: its verb and its text, for example
 * `{ verb: 'rename', text: 'Profile:User' }` for `--rename Profile:User`.
 */
export interface StatementText {
  readonly verb: StatementVerb;
  readonly text: string;
}

/** The `--rename` texts a command was given, as statements, in the order given. */
export function renameStatements(texts: readonly string[] | undefined): readonly StatementText[] {
  return (texts ?? []).map((text) => ({ verb: 'rename', text }));
}
