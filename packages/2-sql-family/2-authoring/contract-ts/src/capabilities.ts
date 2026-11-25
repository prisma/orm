import { mergeCapabilityMatrices } from '@internal/framework-components/components';
import { blindCast } from '@internal/utils/casts';

/** The capabilities one component declares, by namespace. */
export type CapabilitySet = Readonly<Record<string, Readonly<Record<string, boolean>>>>;

type EnabledCapabilityFlags<Flags> = {
  readonly [Flag in keyof Flags as Flags[Flag] extends true ? Flag : never]: true;
};

/** The flags of `Capabilities` that are on, as a contract records them: a flag that is off is the same as one that is absent. */
export type EnabledCapabilities<Capabilities> = {
  readonly [Namespace in keyof Capabilities as keyof EnabledCapabilityFlags<
    Capabilities[Namespace]
  > extends never
    ? never
    : Namespace]: EnabledCapabilityFlags<Capabilities[Namespace]>;
};

/** The flags of `Later` replace those of `Earlier` that it sets, namespace by namespace. */
export type OverrideCapabilities<Earlier, Later> = {
  readonly [Namespace in keyof Earlier | keyof Later]: Namespace extends keyof Later
    ? Namespace extends keyof Earlier
      ? Omit<Earlier[Namespace], keyof Later[Namespace]> & Later[Namespace]
      : Later[Namespace]
    : Namespace extends keyof Earlier
      ? Earlier[Namespace]
      : never;
};

// A set whose type names no namespaces, such as `CapabilitySet` itself, says nothing the type system can merge, so it leaves the earlier sets as they are.
type KnownCapabilities<Set> = string extends keyof Set ? Record<never, never> : Set;

/**
 * The capability sets of a list merged in order, a later set's flags replacing an earlier one's. A list whose length the type does not know keeps only what its first entries the type does know say.
 */
export type MergeCapabilitySets<Sets> = Sets extends readonly [...infer Earlier, infer Last]
  ? OverrideCapabilities<MergeCapabilitySets<Earlier>, KnownCapabilities<Last>>
  : Record<never, never>;

/** The sets merged in order, later flags winning, keeping only the flags that are on. */
export type ResolvedCapabilities<Sets> = EnabledCapabilities<MergeCapabilitySets<Sets>>;

/** A contract's capabilities from `sets`: merged in order, later flags winning, keeping only the flags that are on. */
export function resolveCapabilities<const Sets extends readonly CapabilitySet[]>(
  sets: Sets,
): ResolvedCapabilities<Sets> {
  return blindCast<
    ResolvedCapabilities<Sets>,
    'merges in order and keeps the flags that are on, as ResolvedCapabilities does'
  >(
    enabledCapabilities(
      mergeCapabilityMatrices(
        {},
        sets.map((capabilities) => ({ capabilities })),
      ),
    ),
  );
}

/** The flags of `matrix` that are on. */
export function enabledCapabilities(
  matrix: Record<string, Record<string, boolean>>,
): Record<string, Record<string, true>> {
  const enabled: Record<string, Record<string, true>> = {};
  for (const [namespace, flags] of Object.entries(matrix)) {
    const enabledFlags = Object.fromEntries(
      Object.entries(flags)
        .filter(([, flag]) => flag)
        .map(([name]) => [name, true] as const),
    );
    if (Object.keys(enabledFlags).length > 0) {
      enabled[namespace] = enabledFlags;
    }
  }
  return enabled;
}
