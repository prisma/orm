import type { ControlDefaultLiteralTagTypeEntry } from './mutation-default-types';

/**
 * The `` json`...` `` default literal every target that stores JSON registers. The body is read as
 * a JSON document and checked against the column's codec like any other literal.
 */
export function jsonDefaultLiteralTagEntry(): ControlDefaultLiteralTagTypeEntry {
  return {
    usage: 'json`...`',
    documentation: 'Reads the body as a JSON document and stores it as the default value.',
    literalType: 'json',
  };
}
