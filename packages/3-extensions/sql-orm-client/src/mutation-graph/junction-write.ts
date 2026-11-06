import { ormError } from '../orm-errors';

export interface JunctionWrite {
  readonly relation: string;
  readonly junction: string;
}

export function assertOneValuePerColumn(
  values: Iterable<readonly [column: string, value: unknown]>,
  { relation, junction }: JunctionWrite,
): void {
  const seen = new Map<string, unknown>();
  for (const [column, value] of values) {
    if (seen.has(column) && !Object.is(seen.get(column), value)) {
      throw ormError(
        'ORM.RELATION_MUTATION_INVALID',
        `Cannot write junction "${junction}": conflicting values for junction column "${column}"`,
        { meta: { relation, junction, column } },
      );
    }
    seen.set(column, value);
  }
}
