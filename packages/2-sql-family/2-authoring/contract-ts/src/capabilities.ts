import type { CapabilityMatrix } from '@internal/framework-components/components';
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

/** A capability as a contract's list of required capabilities names it: its namespace and its flag, such as `sql.returning`. */
export type CapabilityKey = `${string}.${string}`;

type NamespaceOf<Key> = Key extends `${infer Namespace}.${string}` ? Namespace : never;
type FlagOf<Key, Namespace extends string> = Key extends `${Namespace}.${infer Flag}`
  ? Flag
  : never;

/** The capabilities `Key` names, as a contract records them: each namespace with its flags, each `true`. */
export type CapabilitiesFromKeys<Key extends CapabilityKey> = {
  readonly [Namespace in NamespaceOf<Key>]: { readonly [Flag in FlagOf<Key, Namespace>]: true };
};

/** The flags of `Capabilities` that are on, each as its key. */
export type CapabilityKeysOf<Capabilities> = {
  [Namespace in keyof Capabilities & string]: {
    [Flag in keyof Capabilities[Namespace] & string]: Capabilities[Namespace][Flag] extends true
      ? `${Namespace}.${Flag}`
      : never;
  }[keyof Capabilities[Namespace] & string];
}[keyof Capabilities & string];

/** The capabilities `keys` names, as a contract records them. A key is split at its first dot. */
export function capabilitiesFromKeys<const Key extends CapabilityKey>(
  keys: readonly Key[],
): CapabilitiesFromKeys<Key> {
  const capabilities: Record<string, Record<string, true>> = {};
  for (const key of keys) {
    const dot = key.indexOf('.');
    const namespace = key.slice(0, dot);
    capabilities[namespace] = { ...capabilities[namespace], [key.slice(dot + 1)]: true };
  }
  return blindCast<CapabilitiesFromKeys<Key>, 'one namespace per key prefix, each flag true'>(
    capabilities,
  );
}

/** The flags of `capabilities` that are on, each as its key, in a frozen list. */
export function capabilityKeysOf<const Capabilities extends CapabilityMatrix>(
  capabilities: Capabilities,
): readonly CapabilityKeysOf<Capabilities>[] {
  const keys = Object.entries(capabilities).flatMap(([namespace, flags]) =>
    Object.entries(flags)
      .filter(([, on]) => on === true)
      .map(([flag]) => `${namespace}.${flag}`),
  );
  return Object.freeze(
    blindCast<CapabilityKeysOf<Capabilities>[], 'the key of each flag that is on'>(keys),
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
