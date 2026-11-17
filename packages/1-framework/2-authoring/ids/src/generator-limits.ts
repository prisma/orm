/** The UUID versions `uuid(version)` generates. */
export const UUID_VERSIONS = { v4: 4, v7: 7 } as const;

/** The one CUID version `cuid(version)` generates. */
export const CUID_VERSION = 2;

/** The sizes a Nano ID may have, inclusive. */
export const NANOID_SIZE = { min: 2, max: 255 } as const;
