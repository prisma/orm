import type {
  ExtensionPackRef,
  FamilyPackRef,
  GeneratorFunctionBinding,
  TargetPackRef,
} from '@internal/framework-components/components';
import { singleGeneratorBinding } from '@internal/framework-components/components';

const uuidBinding: GeneratorFunctionBinding = {
  codecIds: ['pg/text@1'],
  generatorIds: ['uuidv4', 'uuidv7'],
  resolve: ({ args }) => ({
    ok: true,
    generator: { kind: 'generator', id: args['version'] === 7 ? 'uuidv7' : 'uuidv4' },
  }),
  printArguments: () => undefined,
};

const versionType = { optional: true } as { readonly optional: true; readonly _out?: 4 | 7 };

export const familyPack = {
  kind: 'family',
  id: 'sql',
  familyId: 'sql',
  version: '0.0.1',
  generatorFunctions: [
    {
      name: 'uuid',
      signature: { documentation: 'uuid', positional: [{ key: 'version', type: versionType }] },
      bindings: [uuidBinding],
    },
    {
      name: 'now',
      signature: { documentation: 'now' },
      bindings: [
        singleGeneratorBinding({
          codecIds: ['pg/time-temporal@1'],
          generatorId: 'plainTimeNow',
          paramsFromField: (field) =>
            typeof field.typeParams?.['precision'] === 'number'
              ? { precision: field.typeParams['precision'] }
              : undefined,
        }),
      ],
    },
  ],
} as const satisfies FamilyPackRef<'sql'>;

export const targetPack = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  defaultNamespaceId: 'public',
  controlMutationDefaults: {
    defaultFunctionRegistry: new Map(),
    generatorDescriptors: [{ id: 'uuidv4' }, { id: 'uuidv7' }, { id: 'plainTimeNow' }],
  },
} as const satisfies TargetPackRef<'sql', 'postgres'>;

export const slugidPack = {
  kind: 'extension',
  id: 'slugid',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
  generatorFunctions: [
    {
      name: 'slugid',
      signature: { documentation: 'slugid' },
      bindings: [singleGeneratorBinding({ codecIds: ['pg/text@1'], generatorId: 'slugid' })],
    },
  ],
  controlMutationDefaults: {
    defaultFunctionRegistry: new Map(),
    generatorDescriptors: [{ id: 'slugid' }],
  },
} as const satisfies ExtensionPackRef<'sql', 'postgres'>;
