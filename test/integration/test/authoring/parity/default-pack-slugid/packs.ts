import type { SqlControlExtensionDescriptor } from '@internal/family-sql/control';
import { singleGeneratorBinding } from '@internal/framework-components/components';

export const slugidDefaultsPack = {
  kind: 'extension',
  id: 'slugid-defaults',
  version: '0.0.1',
  familyId: 'sql',
  targetId: 'postgres',

  controlMutationDefaults: {
    defaultFunctionRegistry: new Map(),
    generatorDescriptors: [{ id: 'slugid' }],
  },
  generatorFunctions: [
    {
      name: 'slugid',
      signature: { documentation: 'Generates a slug identifier when a field value is omitted.' },
      bindings: [singleGeneratorBinding({ codecIds: ['pg/text@1'], generatorId: 'slugid' })],
    },
  ],
  create() {
    return {
      familyId: 'sql',
      targetId: 'postgres',
    } as const;
  },
} as const satisfies SqlControlExtensionDescriptor<'postgres'>;

export const extensions = [slugidDefaultsPack] as const;
