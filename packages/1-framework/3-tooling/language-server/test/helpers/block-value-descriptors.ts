import type { AuthoringPslBlockDescriptorNamespace } from '@internal/framework-components/authoring';
import {
  bool,
  entityRef,
  funcCall,
  identifier,
  int,
  list,
  mapBlock,
  oneOf,
  optional,
  str,
  structBlock,
} from '@internal/psl-parser';

const everyCall = funcCall('every', {
  documentation: 'Runs on a fixed interval.',
  positional: [{ key: 'interval', type: int(), documentation: 'The interval length.' }],
  named: {
    unit: {
      type: oneOf(
        identifier('seconds', { documentation: 'Interval in seconds.' }),
        identifier('minutes', { documentation: 'Interval in minutes.' }),
      ),
      documentation: 'The interval unit.',
    },
    jitter: { type: optional(bool()), documentation: 'Whether to randomise the start.' },
  },
});

export const blockValueDescriptors: AuthoringPslBlockDescriptorNamespace = {
  role: {
    kind: 'pslBlock',
    keyword: 'role',
    discriminator: 'fixture-role',
    name: { required: true },
    spec: () => structBlock({ parameters: {} }),
  },
  policy_select: {
    kind: 'pslBlock',
    keyword: 'policy_select',
    discriminator: 'fixture-policy-select',
    name: { required: true },
    spec: () =>
      structBlock({
        parameters: {
          target: { type: entityRef({ kind: 'model' }), documentation: 'The protected model.' },
          roles: {
            type: optional(
              list(oneOf(entityRef({ kind: 'block', keyword: 'role' }), identifier())),
            ),
            documentation: 'The roles the policy applies to.',
          },
          using: { type: optional(str()), documentation: 'The row predicate.' },
          permissive: {
            type: optional(bool()),
            documentation: 'Whether the policy is permissive.',
          },
        },
      }),
  },
  priority: {
    kind: 'pslBlock',
    keyword: 'priority',
    discriminator: 'fixture-priority',
    name: { required: true },
    spec: () =>
      mapBlock({
        value: {
          type: oneOf(
            identifier('low', { documentation: 'Low priority.' }),
            identifier('high', { documentation: 'High priority.' }),
          ),
          documentation: 'The priority level.',
        },
      }),
  },
  schedule: {
    kind: 'pslBlock',
    keyword: 'schedule',
    discriminator: 'fixture-schedule',
    name: { required: true },
    spec: () =>
      structBlock({
        parameters: { run: { type: everyCall, documentation: 'When the job runs.' } },
      }),
  },
};

export const blockValueSource = [
  'model User {',
  '  id Int',
  '}',
  'model Post {',
  '  id Int',
  '}',
  'role admin {',
  '}',
  'role reader {',
  '}',
].join('\n');
