const SHELL_SAFE = /^[A-Za-z0-9_.:/@%+,-]+$/;

/** A statement written as the CLI writes its flag: the text single-quoted when a shell would read one of its characters. */
export function statementFlag(verb: 'rename' | 'convert' | 'delete' | 'backfill', text: string) {
  return `--${verb} ${SHELL_SAFE.test(text) ? text : `'${text.replaceAll("'", `'\\''`)}'`}`;
}
