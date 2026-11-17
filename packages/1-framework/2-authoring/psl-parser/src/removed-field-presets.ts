import { argumentsByParameter, printTypeConstructorCall } from './call-arguments';
import {
  type ContributedTypeNamespace,
  writtenContributedTypeCodecId,
} from './contributed-type-scope';
import type { ResolvedTypeConstructorCall } from './resolve';
import type { FieldSymbol } from './symbol-table';

/** A type as a removed preset's rewrite writes it: its path, and the options it is called with, each written as a bare name, such as `as: temporal`. */
export interface RemovedPresetType {
  readonly path: readonly string[];
  readonly options: Readonly<Record<string, string>>;
}

/** The type at the dotted `path`, called with `options`. */
export function presetType(
  path: string,
  options: Readonly<Record<string, string>> = {},
): RemovedPresetType {
  return { path: path.split('.'), options };
}

/** The type as PSL writes it, with `extra` after its options, such as `precision: 3`. */
export function writtenPresetType(type: RemovedPresetType, extra?: string): string {
  const args = [
    ...Object.entries(type.options).map(([name, value]) => `${name}: ${value}`),
    ...(extra === undefined ? [] : [extra]),
  ];
  const path = type.path.join('.');
  return args.length === 0 ? path : `${path}(${args.join(', ')})`;
}

/**
 * A field preset Prisma 8 removed, and how to write what it stored. The preset is named only where `type` resolves to `codecId`, the codec the preset stored, so a row does not fire on a target the preset never existed on, or name a type that stores something else.
 */
export interface RemovedFieldPreset {
  readonly type: RemovedPresetType;
  readonly codecId: string;
  /** The rewrite of `call`, with `modifier`, the field's `?` or `[]`, written right after the type. */
  readonly rewrite: (call: ResolvedTypeConstructorCall, modifier: string) => string;
}

/** A family's removed field presets, keyed by the path a schema called: the rows of each, of which the first that applies names the rewrite, such as a target's own type before the family's. */
export type RemovedFieldPresets = Readonly<Record<string, readonly RemovedFieldPreset[]>>;

const PHASES = ['onCreate', 'onUpdate'] as const;

function asType(type: RemovedPresetType | string): RemovedPresetType {
  return typeof type === 'string' ? presetType(type) : type;
}

/** The row of a preset whose rewrite always writes `type`, then `attributes` when given, such as `Ulid @id @onCreate(ulid())`. */
export function removedPresetWrittenAs(
  type: RemovedPresetType | string,
  codecId: string,
  attributes?: string,
): readonly RemovedFieldPreset[] {
  const written = asType(type);
  const suffix = attributes === undefined ? '' : ` ${attributes}`;
  return [
    {
      type: written,
      codecId,
      rewrite: (_, modifier) => `Write ${writtenPresetType(written)}${modifier}${suffix}.`,
    },
  ];
}

/** A convenience type that gives a row's explicit type for every written precision, and the precision it gives when none is written. */
export interface RemovedPresetPrecisionType {
  readonly type: RemovedPresetType;
  readonly defaultPrecision: string;
}

/**
 * The row of a preset that took `onCreate: now` and `onUpdate: now`, and a precision first when `takesPrecision`. Its rewrite writes `type`, with the precision as its `precision` argument and `@onCreate(now())` and `@onUpdate(now())` for the phases the call set. When the call writes a precision and `withPrecision` is given, it writes `withPrecision.type` instead, leaving out a precision equal to its default.
 */
export function removedPresetWithPhases(
  type: RemovedPresetType | string,
  codecId: string,
  takesPrecision: boolean,
  withPrecision?: RemovedPresetPrecisionType,
): readonly RemovedFieldPreset[] {
  const written = asType(type);
  const parameters = takesPrecision ? ['precision', ...PHASES] : [...PHASES];
  return [
    {
      type: written,
      codecId,
      rewrite: (call, modifier) => {
        const args = argumentsByParameter(call.args, parameters);
        const precision = args?.get('precision');
        if (
          args === undefined ||
          (precision !== undefined && !/^\d+$/.test(precision)) ||
          PHASES.some((phase) => args.has(phase) && args.get(phase) !== 'now')
        ) {
          return `Write ${writtenPresetType(written, takesPrecision ? '...' : undefined)}${modifier} with @onCreate(now()) and @onUpdate(now()) for the phases the preset set.`;
        }
        const attributes = PHASES.filter((phase) => args.has(phase)).map(
          (phase) => ` @${phase}(now())`,
        );
        const typeText =
          precision === undefined
            ? writtenPresetType(written)
            : withPrecision === undefined
              ? writtenPresetType(written, `precision: ${precision}`)
              : writtenPresetType(
                  withPrecision.type,
                  precision === withPrecision.defaultPrecision
                    ? undefined
                    : `precision: ${precision}`,
                );
        return `Write ${typeText}${modifier}${attributes.join('')}.`;
      },
    },
  ];
}

/** The `?` or `[]` a field writes right after its type. */
function typeModifier(field: FieldSymbol): string {
  if (field.list) return field.elementOptional ? '?[]' : '[]';
  return field.optional ? '?' : '';
}

/**
 * The refusal of a field typed by a call to a field preset Prisma 8 removed, naming what to write instead, with the field's `?` or `[]` right after the type and before any attribute. `undefined` when the field is not typed by a call, or `presets` has no row for the call that applies to a stack whose types `types` holds. A row applies where its type, called as the rewrite writes it, resolves as a column would, to the row's codec. A row is skipped when `isDeclared` says the schema declares the first name of its type, because the rewrite would then name the schema's declaration.
 */
export function describeRemovedFieldPreset(
  presets: RemovedFieldPresets,
  field: FieldSymbol,
  types: ContributedTypeNamespace,
  isDeclared: (name: string) => boolean,
): string | undefined {
  const call = field.typeConstructor;
  if (call === undefined) return undefined;
  const path = call.path.join('.');
  const rows = Object.hasOwn(presets, path) ? presets[path] : undefined;
  const preset = rows?.find((row) => {
    const [name] = row.type.path;
    const codecId = writtenContributedTypeCodecId(types, {
      path: row.type.path,
      args: Object.entries(row.type.options).map(([option, value]) => ({
        kind: 'named',
        name: option,
        value,
        span: call.span,
      })),
      span: call.span,
    });
    return codecId === row.codecId && (name === undefined || !isDeclared(name));
  });
  if (preset === undefined) return undefined;
  return `${printTypeConstructorCall(call)} was a field preset, and Prisma 8 removed field presets. ${preset.rewrite(call, typeModifier(field))}`;
}
