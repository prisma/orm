import type { AuthoringArgumentDescriptor } from '@internal/framework-components/authoring';

/**
 * Hand-written mirrors of family-sql's shipping
 * `sqlFamilyAuthoringFieldPresets.{nanoid, id.nanoid}`.
 *
 * They are hand-written because this package cannot import family-sql:
 * family-sql declares `@internal/sql-contract-ts` as a production
 * dependency, so the reverse import would be a cycle.
 *
 * They are kept honest by `family-sql/test/authoring-field-presets.test.ts`,
 * which imports each mirror below and asserts it deep-equals the shipping
 * descriptor.
 *
 * {@link nanoidOptionsArgumentMirror} is the one that matters most. Every
 * property it declares is optional, which makes `ObjectArgumentType` emit a
 * plain weak type — and weak-type detection is the only thing that rejects
 * `field.id.nanoid({ bogus: 1 })` or routes `field.id.nanoid({ name: 'x' })`
 * to the named-constraint overload, because the TS authoring surface runs no
 * runtime argument validation. If `size` ever becomes required upstream,
 * `ObjectArgumentType` takes its intersection branch instead and that
 * protection silently evaporates. The anchor exists so that change surfaces
 * as a red test here rather than as wrong DDL in a user's database.
 */
export const nanoidOptionsArgumentMirror = {
  kind: 'object',
  optional: true,
  properties: {
    size: { kind: 'number', optional: true, integer: true, minimum: 2, maximum: 255 },
  },
} as const satisfies AuthoringArgumentDescriptor;

export const nanoidPresetMirror = {
  kind: 'fieldPreset',
  args: [nanoidOptionsArgumentMirror],
  output: {
    codecId: 'sql/char@1',
    typeParams: { length: { kind: 'arg', index: 0, path: ['size'], default: 21 } },
  },
} as const;

export const nanoidIdPresetMirror = {
  kind: 'fieldPreset',
  args: [nanoidOptionsArgumentMirror],
  output: {
    codecId: 'sql/char@1',
    typeParams: { length: { kind: 'arg', index: 0, path: ['size'], default: 21 } },
    executionDefaults: {
      onCreate: {
        kind: 'generator',
        id: 'nanoid',
        params: { size: { kind: 'arg', index: 0, path: ['size'] } },
      },
    },
    id: true,
  },
} as const;
