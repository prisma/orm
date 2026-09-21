/**
 * The two kinds of default literal tag entry are mutually exclusive: one lowers its own body, the
 * other names the literal type its body is read as, and no entry does both.
 */

import { expectTypeOf, test } from 'vitest';
import type {
  ControlDefaultLiteralTagEntry,
  ControlDefaultLiteralTagLoweringEntry,
  ControlDefaultLiteralTagTypeEntry,
} from '../src/exports/control';

const lowering = {
  usage: 'sql`...`',
  documentation: 'Raw SQL.',
  lower: () => ({
    ok: true as const,
    value: {
      kind: 'storage' as const,
      defaultValue: { kind: 'function' as const, expression: 'now()' },
    },
  }),
} satisfies ControlDefaultLiteralTagLoweringEntry;

const naming = {
  usage: 'json`...`',
  documentation: 'A JSON document.',
  literalType: 'json',
} satisfies ControlDefaultLiteralTagTypeEntry;

test('each kind is a tag entry on its own', () => {
  lowering satisfies ControlDefaultLiteralTagEntry;
  naming satisfies ControlDefaultLiteralTagEntry;
  expectTypeOf<ControlDefaultLiteralTagEntry>().not.toBeAny();
});

test('an entry that both lowers and names a literal type is rejected', () => {
  const both = {
    usage: 'both`...`',
    documentation: 'Neither one thing nor the other.',
    lower: lowering.lower,
    literalType: 'json' as const,
  };
  // @ts-expect-error -- an entry lowers its own body or names a literal type, never both
  both satisfies ControlDefaultLiteralTagEntry;
  expectTypeOf<typeof both>().not.toBeAny();
});
