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

const policyParameters = {
  target: { type: entityRef({ kind: 'model' }), documentation: 'The protected model.' },
  roles: {
    type: optional(list(oneOf(entityRef({ kind: 'block', keyword: 'role' }), identifier()))),
    documentation: 'The roles the policy applies to.',
  },
  using: { type: optional(str()), documentation: 'The row predicate.' },
  permissive: { type: optional(bool()), documentation: 'Whether the policy is permissive.' },
};

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
    spec: () => structBlock({ parameters: policyParameters }),
  },
  policy_all: {
    kind: 'pslBlock',
    keyword: 'policy_all',
    discriminator: 'fixture-policy-all',
    name: { required: true },
    spec: () =>
      structBlock({
        parameters: {
          ...policyParameters,
          withCheck: { type: optional(str()), documentation: 'The written-row predicate.' },
        },
      }),
  },
  grant: {
    kind: 'pslBlock',
    keyword: 'grant',
    discriminator: 'fixture-grant',
    name: { required: true },
    spec: () =>
      structBlock({
        parameters: {
          roles: {
            type: list(entityRef({ kind: 'block', keyword: 'role' })),
            documentation: 'The granted roles.',
          },
          note: { type: optional(str()), documentation: 'A free-form note.' },
          target: { type: entityRef({ kind: 'model' }), documentation: 'The granted model.' },
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
