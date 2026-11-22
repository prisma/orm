import { blindCast } from '@internal/utils/casts';
import type { Type } from 'arktype';
import { runtimeError } from '../shared/runtime-error';

export interface EntityKindDescriptor<Input, Node> {
  readonly kind: string;
  // Type<unknown>, not Type<Input>: AnyEntityKindDescriptor widens Input to never, which would force an unusable Type<never>; concrete descriptors still carry their real schema.
  readonly schema: Type<unknown>;
  readonly construct: (input: Input) => Node;
}

export type AnyEntityKindDescriptor = EntityKindDescriptor<never, unknown>;

/**
 * Hydrates a namespace's entities from raw JSON maps into IR class instances.
 *
 * For each kind in `entries`: if the descriptor map has a descriptor,
 * construct each inner-map value; otherwise freeze-and-carry (`'carry'`)
 * or throw naming the kind and nsId (`'fail'`).
 *
 * The single boundary cast hands `value` to `descriptor.construct` as its
 * `Input`. The value satisfies the kind's `Input` either by the
 * entries-input contract at authoring time or by prior `validateStorage`
 * validation at hydration time.
 */
export function hydrateNamespaceEntities(
  entries: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
  kinds: ReadonlyMap<string, AnyEntityKindDescriptor>,
  onUnknown: 'carry' | 'fail',
  nsId?: string,
): Record<string, Readonly<Record<string, unknown>>> {
  const result: Record<string, Readonly<Record<string, unknown>>> = {};
  for (const [kind, rawMap] of Object.entries(entries)) {
    const descriptor = kinds.get(kind);
    if (descriptor !== undefined) {
      const built: Record<string, unknown> = {};
      for (const [name, value] of Object.entries(rawMap)) {
        Object.defineProperty(built, name, {
          value: descriptor.construct(
            blindCast<
              never,
              "value is this kind's descriptor Input: when authoring, the typed entries-input contract produces it; when hydrating, it was validated against descriptor.schema before this loop. The never target is AnyEntityKindDescriptor's erased Input parameter."
            >(value),
          ),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
      result[kind] = Object.freeze(built);
    } else if (onUnknown === 'carry') {
      result[kind] = Object.freeze(rawMap);
    } else {
      throw runtimeError(
        'CONTRACT.ENTITY_KIND_UNKNOWN',
        `Unknown entries key "${kind}" in namespace "${nsId ?? '?'}"; no hydration factory registered for this entity kind`,
      );
    }
  }
  return result;
}
