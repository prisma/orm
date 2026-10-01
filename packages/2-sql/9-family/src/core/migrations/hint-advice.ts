import type { ConsumedHint } from '@internal/framework-components/control';

/** The line `migration plan` prints under `Hints applied` for a hint the plan acted on. */
export function describeConsumedHint(hint: ConsumedHint): string {
  const table = hint.coordinate.entityName;
  const column = hint.memberName;
  if (hint.kind === 'deleted') {
    return column === undefined
      ? `deleted hint on table "${table}": dropped and recorded; you can remove the model.`
      : `deleted hint on column "${table}"."${column}": dropped and recorded; you can remove the field.`;
  }
  return column === undefined
    ? `rename hint on table "${table}" (was "${hint.from}"): renamed and recorded in this migration; you can remove the hint.`
    : `rename hint on column "${table}"."${column}" (was "${hint.from}"): renamed and recorded; you can remove the hint.`;
}
