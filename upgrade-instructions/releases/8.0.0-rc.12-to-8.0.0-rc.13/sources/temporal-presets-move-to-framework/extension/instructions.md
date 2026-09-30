---
changes:
  - id: temporal-presets-move-to-framework
    summary: |
      `TIMESTAMP_NOW_GENERATOR_ID`, `temporalAuthoringPresets` and `temporalCodecPreset` moved from
      the SQL family's `family/control` subpath to the framework's `components/authoring`, and
      `timestampNowControlDescriptor` moved to `components/control`. `temporalCodecPresetWithPrecision`
      and `temporalStringAuthoringPresets` stay in `family/control`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\b(?:TIMESTAMP_NOW_GENERATOR_ID|temporalAuthoringPresets|temporalCodecPreset|timestampNowControlDescriptor)\b[^;]*?from\s*[''"](?:@internal/family-sql/control|@prisma/orm-(?:family-sql|postgres|sqlite)/family/control)[''"]'
  - id: temporal-preset-builders-take-storage-template
    summary: |
      `temporalAuthoringPresets`, `temporalStringAuthoringPresets` and `temporalCodecPreset` take the
      codec's storage template as one type parameter (`<Storage, GeneratorId>`, or `<Storage>` for
      `temporalCodecPreset`) instead of `<CodecId, NativeType, GeneratorId>`. Calls that let
      TypeScript infer the type arguments are unchanged.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\b(?:temporalAuthoringPresets|temporalStringAuthoringPresets|temporalCodecPreset)\s*<'
---

## `temporal-presets-move-to-framework`

The target-neutral temporal preset builders now live in the framework, so a non-SQL target can build `temporal.*` presets too. Change the import source; the functions behave the same.

```ts
// before
import {
  TIMESTAMP_NOW_GENERATOR_ID,
  temporalAuthoringPresets,
  temporalCodecPreset,
  timestampNowControlDescriptor,
} from '@prisma/orm-family-sql/family/control';

// after
import {
  TIMESTAMP_NOW_GENERATOR_ID,
  temporalAuthoringPresets,
  temporalCodecPreset,
} from '@prisma/orm-framework/components/authoring';
import { timestampNowControlDescriptor } from '@prisma/orm-framework/components/control';
```

The same applies to the `family/control` subpaths of `@prisma/orm-postgres` and `@prisma/orm-sqlite` (move to their `components/authoring` and `components/control` subpaths), and to `@internal/family-sql/control` (move to `@internal/framework-components/authoring` and `@internal/framework-components/control`). Keep importing `temporalCodecPresetWithPrecision` and `temporalStringAuthoringPresets` from `family/control`.

## `temporal-preset-builders-take-storage-template`

The builders now carry the codec's whole storage template through, so their type parameters changed. Drop explicit type arguments and let TypeScript infer them:

```ts
// before
temporalAuthoringPresets<'pg/timestamptz@1', 'timestamptz'>({ codecId: 'pg/timestamptz@1', nativeType: 'timestamptz' });

// after
temporalAuthoringPresets({ codecId: 'pg/timestamptz@1', nativeType: 'timestamptz' });
```

If you need to name them, the first type parameter is the storage template object type (`{ readonly codecId: ...; readonly nativeType: ... }`).
