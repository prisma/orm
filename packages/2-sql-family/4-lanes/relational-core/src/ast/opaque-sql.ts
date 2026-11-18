/**
 * SQL text that Prisma does not parse, placed inside a larger statement: a CHECK or policy predicate, an index element list or predicate, a column default, or an ALTER COLUMN TYPE conversion. ADR 244 calls such text opaque.
 */
export class OpaqueSql {
  readonly text: string;
  constructor(text: string) {
    this.text = text;
    Object.freeze(this);
  }
}

export function opaqueSql(text: string): OpaqueSql {
  return new OpaqueSql(text);
}

/**
 * The text as a statement includes it. Text containing `--` ends with a line break, so a line comment on its last line cannot hide what the statement writes after it.
 */
export function renderOpaqueSql(sql: OpaqueSql): string {
  return sql.text.includes('--') ? `${sql.text}\n` : sql.text;
}
