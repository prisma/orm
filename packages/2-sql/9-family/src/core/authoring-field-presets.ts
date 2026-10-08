import type { AuthoringFieldNamespace } from '@internal/framework-components/authoring';

/**
 * Family-level SQL authoring field presets.
 *
 * Only presets whose codec IDs align with the ID generator metadata live here
 * (see `@internal/ids`). These presets are target-agnostic because the
 * generator metadata fixes their codec/native-type to `sql/char@1`
 * (`character`) regardless of target, and the PSL interpreter lets the
 * generator override the scalar descriptor.
 *
 * The `uuidString` / `id.uuidv4String` / `id.uuidv7String` presets store UUID
 * values as `character(36)` — portable across all SQL targets. For a native
 * Postgres `uuid` column use `uuidNative` / `id.uuidv4Native` /
 * `id.uuidv7Native` from `@internal/target-postgres`.
 *
 * Scalar presets that map to target-specific codecs (e.g. `text`, `int`,
 * `boolean`, `dateTime`) are contributed by the target pack (see
 * `postgresAuthoringFieldPresets` in `@internal/target-postgres`) so the
 * TS callback surface and the PSL scalar surface lower to byte-identical
 * contracts for the active target.
 */

const CHARACTER_CODEC_ID = 'sql/char@1';

const nanoidOptionsArgument = {
  kind: 'object',
  optional: true,
  properties: {
    size: {
      kind: 'number',
      optional: true,
      integer: true,
      minimum: 2,
      maximum: 255,
    },
  },
} as const;

export const sqlFamilyAuthoringFieldPresets = {
  uuidString: {
    kind: 'fieldPreset',
    output: {
      codecId: CHARACTER_CODEC_ID,
      typeParams: {
        length: 36,
      },
    },
  },
  ulid: {
    kind: 'fieldPreset',
    output: {
      codecId: CHARACTER_CODEC_ID,
      typeParams: {
        length: 26,
      },
    },
  },
  nanoid: {
    kind: 'fieldPreset',
    args: [nanoidOptionsArgument],
    output: {
      codecId: CHARACTER_CODEC_ID,
      typeParams: {
        length: {
          kind: 'arg',
          index: 0,
          path: ['size'],
          default: 21,
        },
      },
    },
  },
  cuid2: {
    kind: 'fieldPreset',
    output: {
      codecId: CHARACTER_CODEC_ID,
      typeParams: {
        length: 24,
      },
    },
  },
  ksuid: {
    kind: 'fieldPreset',
    output: {
      codecId: CHARACTER_CODEC_ID,
      typeParams: {
        length: 27,
      },
    },
  },
  id: {
    uuidv4String: {
      kind: 'fieldPreset',
      output: {
        codecId: CHARACTER_CODEC_ID,
        typeParams: {
          length: 36,
        },
        executionDefaults: {
          onCreate: {
            kind: 'generator',
            id: 'uuidv4',
          },
        },
        id: true,
      },
    },
    uuidv7String: {
      kind: 'fieldPreset',
      output: {
        codecId: CHARACTER_CODEC_ID,
        typeParams: {
          length: 36,
        },
        executionDefaults: {
          onCreate: {
            kind: 'generator',
            id: 'uuidv7',
          },
        },
        id: true,
      },
    },
    ulid: {
      kind: 'fieldPreset',
      output: {
        codecId: CHARACTER_CODEC_ID,
        typeParams: {
          length: 26,
        },
        executionDefaults: {
          onCreate: {
            kind: 'generator',
            id: 'ulid',
          },
        },
        id: true,
      },
    },
    nanoid: {
      kind: 'fieldPreset',
      args: [nanoidOptionsArgument],
      output: {
        codecId: CHARACTER_CODEC_ID,
        typeParams: {
          length: {
            kind: 'arg',
            index: 0,
            path: ['size'],
            default: 21,
          },
        },
        executionDefaults: {
          onCreate: {
            kind: 'generator',
            id: 'nanoid',
            params: {
              size: {
                kind: 'arg',
                index: 0,
                path: ['size'],
              },
            },
          },
        },
        id: true,
      },
    },
    cuid2: {
      kind: 'fieldPreset',
      output: {
        codecId: CHARACTER_CODEC_ID,
        typeParams: {
          length: 24,
        },
        executionDefaults: {
          onCreate: {
            kind: 'generator',
            id: 'cuid2',
          },
        },
        id: true,
      },
    },
    ksuid: {
      kind: 'fieldPreset',
      output: {
        codecId: CHARACTER_CODEC_ID,
        typeParams: {
          length: 27,
        },
        executionDefaults: {
          onCreate: {
            kind: 'generator',
            id: 'ksuid',
          },
        },
        id: true,
      },
    },
  },
} as const satisfies AuthoringFieldNamespace;
