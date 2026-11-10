import { type } from 'arktype';

/** The shape a check's expectation must have where it is read from an `ops.json`. */
const CheckExpectationSchema = type({
  expects: "'absent' | 'present'",
  object: 'string > 0',
});

/** What a check may say of the object it is about: an expectation, or the object's name alone. */
const CheckSchema = type({
  'expectation?': CheckExpectationSchema,
  'object?': 'string > 0',
});

export const MigrationOpSchema = type({
  id: 'string',
  label: 'string',
  operationClass: "'additive' | 'widening' | 'destructive' | 'data'",
  'invariantId?': 'string',
  'precheck?': CheckSchema.array(),
  'postcheck?': CheckSchema.array(),
});

// Intentionally shallow: operation-specific payload validation is owned by planner/runner layers.
export const MigrationOpsSchema = MigrationOpSchema.array();
