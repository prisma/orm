import type { SqlControlExtensionDescriptor } from '@internal/family-sql/control';
import type { ControlMutationDefaultEntry } from '@internal/framework-components/control';

// `slugid()` takes no arguments; its signature makes arity a grammar concern, so any
// `slugid(...)` call fails as invalid attribute syntax before the lower runs.
const slugidEntry: ControlMutationDefaultEntry = {
  signature: { documentation: 'Generates a slug identifier when a field value is omitted.' },
  lower: () => ({
    ok: true,
    value: {
      kind: 'execution',
      generated: {
        kind: 'generator',
        id: 'slugid',
      },
    },
  }),
  usageSignatures: ['slugid()'],
};

const slugidDefaultsPack: SqlControlExtensionDescriptor<'postgres'> = {
  kind: 'extension',
  id: 'slugid-defaults',
  version: '0.0.1',
  familyId: 'sql',
  targetId: 'postgres',

  controlMutationDefaults: {
    defaultFunctionRegistry: new Map([['slugid', slugidEntry]]),
    defaultLiteralTagRegistry: new Map(),
    generatorDescriptors: [{ id: 'slugid', applicableCodecIds: ['pg/text@1'] }],
  },
  create() {
    return {
      familyId: 'sql',
      targetId: 'postgres',
    };
  },
};

export const extensions = [slugidDefaultsPack] as const;
