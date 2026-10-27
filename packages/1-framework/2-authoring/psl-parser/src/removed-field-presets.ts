import { argumentsByParameter, printTypeConstructorCall } from './call-arguments';
import {
  type ContributedTypeNamespace,
  contributedTypeAt,
  contributedTypeCodecId,
} from './contributed-type-scope';
import type { ResolvedTypeConstructorCall } from './resolve';

/**
 * A field preset Prisma 8 removed, and how to write what it stored. The preset is named only where `type` resolves, and to `codecId` when one is given, so a row does not fire on a target the preset never existed on.
 */
export interface RemovedFieldPreset {
  readonly type: readonly string[];
  readonly codecId?: string;
  readonly rewrite: (call: ResolvedTypeConstructorCall) => string;
}

/** A family's removed field presets, keyed by the path a schema called: the rows of each, of which the first that applies names the rewrite, such as a target's own type before the family's. */
export type RemovedFieldPresets = Readonly<Record<string, readonly RemovedFieldPreset[]>>;

const PHASES = ['onCreate', 'onUpdate'] as const;

/** The row of a preset whose rewrite is always `written`, such as `Ulid @id @onCreate(ulid())`; its type is the first word of `written`. */
export function removedPresetWrittenAs(
  written: string,
  codecId?: string,
): readonly RemovedFieldPreset[] {
  const [type = written] = written.split(/[ (]/);
  return [
    {
      type: type.split('.'),
      ...(codecId === undefined ? {} : { codecId }),
      rewrite: () => `Write ${written}.`,
    },
  ];
}

/**
 * The row of a preset that took `onCreate: now` and `onUpdate: now`, and a precision first when `takesPrecision`. Its rewrite writes `type`, with the precision as its argument and `@onCreate(now())` and `@onUpdate(now())` for the phases the call set.
 */
export function removedPresetWithPhases(
  type: string,
  codecId: string,
  takesPrecision: boolean,
): readonly RemovedFieldPreset[] {
  const parameters = takesPrecision ? ['precision', ...PHASES] : [...PHASES];
  const fallback = `Write ${type}${takesPrecision ? '(...)' : ''} with @onCreate(now()) and @onUpdate(now()) for the phases the preset set.`;
  return [
    {
      type: [type],
      codecId,
      rewrite: (call) => {
        const args = argumentsByParameter(call.args, parameters);
        const precision = args?.get('precision');
        if (
          args === undefined ||
          (precision !== undefined && !/^\d+$/.test(precision)) ||
          PHASES.some((phase) => args.has(phase) && args.get(phase) !== 'now')
        ) {
          return fallback;
        }
        const attributes = PHASES.filter((phase) => args.has(phase)).map(
          (phase) => ` @${phase}(now())`,
        );
        return `Write ${type}${precision === undefined ? '' : `(${precision})`}${attributes.join('')}.`;
      },
    },
  ];
}

/**
 * The refusal of a call to a field preset Prisma 8 removed, naming what to write instead, or `undefined` when `presets` has no row for the call that applies to a stack whose types `types` holds. A row is skipped when `isDeclared` says the schema declares the first name of its type, because the rewrite would then name the schema's declaration.
 */
export function describeRemovedFieldPreset(
  presets: RemovedFieldPresets,
  call: ResolvedTypeConstructorCall,
  types: ContributedTypeNamespace,
  isDeclared: (name: string) => boolean,
): string | undefined {
  const path = call.path.join('.');
  const rows = Object.hasOwn(presets, path) ? presets[path] : undefined;
  const preset = rows?.find((row) => {
    const [name] = row.type;
    const replacement = contributedTypeAt(types, row.type);
    return (
      replacement !== undefined &&
      (name === undefined || !isDeclared(name)) &&
      (row.codecId === undefined || contributedTypeCodecId(replacement) === row.codecId)
    );
  });
  if (preset === undefined) return undefined;
  return `${printTypeConstructorCall(call)} was a field preset, and Prisma 8 removed field presets. ${preset.rewrite(call)}`;
}
