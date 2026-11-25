import {
  type CapabilityMatrix,
  mergeCapabilityMatrices,
} from '@internal/framework-components/components';
import { blindCast } from '@internal/utils/casts';

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

// A set whose type names no namespaces, such as `CapabilityMatrix` itself, says nothing the type system can merge, so it leaves the earlier sets as they are, even when it turns a flag off at run time.
type KnownCapabilities<Set> = string extends keyof Set ? Record<never, never> : Set;

type MergeFrom<Merged, Sets> = Sets extends readonly [infer Head, ...infer Tail]
  ? MergeFrom<OverrideCapabilities<Merged, KnownCapabilities<Head>>, Tail>
  : Merged;

/**
 * The capability sets of a list merged in order, a later set's flags replacing an earlier one's. Entries the type knows at the front of the list are merged; a rest of unknown length adds nothing.
 */
export type MergeCapabilitySets<Sets> = MergeFrom<Record<never, never>, Sets>;

/** The sets merged in order, later flags winning, keeping only the flags that are on. */
export type ResolvedCapabilities<Sets> = EnabledCapabilities<MergeCapabilitySets<Sets>>;

/** A contract's capabilities from `sets`: merged in order, later flags winning, keeping only the flags that are on. */
export function resolveCapabilities<const Sets extends readonly CapabilityMatrix[]>(
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
