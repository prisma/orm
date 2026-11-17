import { blindCast } from '@internal/utils/casts';
import { type Type, type } from 'arktype';
import type { ContractExecutionSection } from './contract-types';

const generatorIdSchema = type('string').narrow((value, ctx) => {
  return /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value) ? true : ctx.mustBe('a flat generator id');
});

const ExecutionMutationDefaultValueSchema = type({
  '+': 'reject',
  kind: "'generator'",
  id: generatorIdSchema,
  'params?': 'Record<string, unknown>',
});

const ExecutionMutationDefaultSchema = type({
  '+': 'reject',
  ref: {
    '+': 'reject',
    namespace: 'string',
    entry: 'string',
    field: 'string',
  },
  'onCreate?': ExecutionMutationDefaultValueSchema,
  'onUpdate?': ExecutionMutationDefaultValueSchema,
});

export const ContractExecutionSectionSchema = /* @__PURE__ */ blindCast<
  Type<ContractExecutionSection>,
  'executionHash is validated as string at runtime; the public type carries the ExecutionHash brand, which only the hashing helpers produce'
>(
  /* @__PURE__ */ type({
    '+': 'reject',
    executionHash: 'string',
    mutations: {
      '+': 'reject',
      defaults: ExecutionMutationDefaultSchema.array().readonly(),
    },
  }),
);
