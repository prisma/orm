import type { CodecRef } from '@internal/framework-components/codec';
import type {
  AggregateResultNullability,
  NamedAggregateOutput,
} from '@internal/framework-components/components';
import {
  aggregateDescriptorKey,
  isAnyInputAggregateDescriptor,
  isNoInputAggregateDescriptor,
  settleAggregateOverloads,
} from '@internal/framework-components/components';
import { ifDefined } from '@internal/utils/defined';
import { structuredError } from '@internal/utils/structured-error';
import type { SqlAggregateDescriptor } from './aggregate-descriptor';
import { isSqlAggregateDescriptor } from './aggregate-descriptor';
import { frozenCodecRef } from './ast/codec-types';
import { aggregateFnNames, isAggregateFn } from './ast/types';
import type {
  CodecDescriptorRegistry,
  ResolvedSqlAggregate,
  SqlAggregateDescriptorRegistry,
} from './query-lane-context';

interface OperationTable {
  /** What a call carrying no input resolves to: the no-input overload, else the input-agnostic one. */
  readonly withoutInput: ResolvedSqlAggregate | undefined;
  /** Per codec id, the overload settled from the exact and trait rungs. */
  readonly byCodecId: ReadonlyMap<string, SqlAggregateDescriptor>;
  /** The input-agnostic overload, consulted for an input no exact or trait rung claims. */
  readonly anyInput: SqlAggregateDescriptor | undefined;
}

function namedOutputRef(output: NamedAggregateOutput, input: CodecRef | undefined): CodecRef {
  return frozenCodecRef({
    codecId: output.codecId,
    ...ifDefined('typeParams', output.typeParams?.(input)),
  });
}

/** The descriptor's own answer for a result set carrying no row, carried into resolution unchanged. */
function resultNullability(descriptor: SqlAggregateDescriptor): AggregateResultNullability {
  return descriptor.nullable
    ? { nullable: true }
    : { nullable: false, emptyResultWire: descriptor.emptyResultWire };
}

/**
 * Validate every contributed aggregate descriptor and settle its matches against the composed codec set.
 *
 * Validation covers the descriptor's own shape, the lowering rule — an operation outside the closed SQL aggregate alphabet must carry a `lower` hook, there being no plain `AggregateExpr` form for it — a second claim on one `(operation, input)` pair, and two trait descriptors that both claim a registered codec for one operation — the last of which only a composed stack can detect, which is why it is settled here rather than at contribution.
 */
export function buildSqlAggregateDescriptorRegistry(
  descriptors: ReadonlyArray<unknown>,
  codecDescriptors: CodecDescriptorRegistry,
): SqlAggregateDescriptorRegistry {
  const validated: SqlAggregateDescriptor[] = [];
  const claimedKeys = new Set<string>();

  for (const candidate of descriptors) {
    if (!isSqlAggregateDescriptor(candidate)) {
      throw structuredError(
        'RUNTIME.AGGREGATE_DESCRIPTOR_INVALID',
        `Contributed value ${describeCandidate(candidate)} is not a valid SQL aggregate descriptor.`,
        {
          why: 'Aggregate resolution reads a declared operation, input match, result codec, and nullability — plus, for a non-nullable result, the empty-result value; a lowering hook, where present, must be callable.',
          fix: 'Declare `operation`, `input` (`none` / `any` / `codec` / `trait`), `output` (`self` / `codec`), and `nullable` on the descriptor, adding `emptyResultWire` where `nullable` is false.',
          meta: { descriptor: describeCandidate(candidate) },
        },
      );
    }

    const key = aggregateDescriptorKey(candidate);
    if (!isAggregateFn(candidate.operation) && candidate.lower === undefined) {
      throw structuredError(
        'RUNTIME.AGGREGATE_LOWERING_MISSING',
        `Aggregate descriptor '${key}' declares operation '${candidate.operation}', which is outside the SQL aggregate alphabet (${[...aggregateFnNames].join(', ')}) and carries no lowering hook.`,
        {
          why: 'An operation in the alphabet lowers to a plain aggregate call; renderers know no other operation, so any other name must build its expression through a `lower` hook from existing nodes.',
          fix: 'Declare a `lower` hook on the descriptor, or use an operation name from the SQL aggregate alphabet.',
          meta: { operation: candidate.operation, key },
        },
      );
    }
    if (claimedKeys.has(key)) {
      throw structuredError(
        'RUNTIME.DUPLICATE_AGGREGATE_DESCRIPTOR',
        `Duplicate aggregate descriptor for '${key}'.`,
        {
          why: 'Each operation/input pair resolves to exactly one result codec, so exactly one component may claim it.',
          fix: 'Remove the duplicate target, adapter, or extension contribution.',
          meta: { key },
        },
      );
    }
    claimedKeys.add(key);
    validated.push(candidate);
  }

  const settled = settleAggregateOverloads(validated, codecDescriptors.values());
  const ambiguity = settled.ambiguities[0];
  if (ambiguity !== undefined) {
    throw structuredError(
      'RUNTIME.AMBIGUOUS_AGGREGATE_DESCRIPTOR',
      `Ambiguous aggregate descriptors for '${ambiguity.operation}' over codec '${ambiguity.codecId}': traits ${ambiguity.traits.join(', ')} all claim it.`,
      {
        why: 'A codec advertising several claimed traits leaves the result codec undetermined.',
        fix: `Contribute an exact descriptor for '${ambiguity.operation}' over '${ambiguity.codecId}', or narrow the overlapping trait contributions.`,
        meta: {
          operation: ambiguity.operation,
          codecId: ambiguity.codecId,
          traits: ambiguity.traits,
        },
      },
    );
  }

  for (const descriptor of validated) {
    const outputCodecId =
      descriptor.output.kind === 'codec'
        ? descriptor.output.codecId
        : descriptor.input.kind === 'codec'
          ? descriptor.input.codecId
          : undefined;
    if (
      outputCodecId !== undefined &&
      codecDescriptors.descriptorFor(outputCodecId) === undefined
    ) {
      const key = aggregateDescriptorKey(descriptor);
      throw structuredError(
        'RUNTIME.AGGREGATE_OUTPUT_CODEC_MISSING',
        `Aggregate descriptor '${key}' names result codec '${outputCodecId}', which the composed stack does not register.`,
        {
          why: 'A resolved aggregate decodes its result through the declared codec; a codec the stack does not compose cannot decode anything.',
          fix: 'Register the codec on the composed stack, or declare a result codec the stack composes.',
          meta: { operation: descriptor.operation, key, outputCodecId },
        },
      );
    }
  }

  const tables = new Map<string, OperationTable>();
  for (const [operation, entry] of settled.operations) {
    tables.set(operation, {
      withoutInput:
        resolveWithoutInput(operation, entry.noInput) ??
        resolveWithoutInput(operation, entry.anyInput),
      byCodecId: entry.byCodecId,
      anyInput: entry.anyInput,
    });
  }

  return {
    resolve(operation: string, input?: CodecRef): ResolvedSqlAggregate | undefined {
      const table = tables.get(operation);
      if (table === undefined) return undefined;
      if (input === undefined) return table.withoutInput;

      const descriptor = table.byCodecId.get(input.codecId) ?? table.anyInput;
      if (descriptor === undefined) return undefined;

      return {
        operation,
        output:
          descriptor.output.kind === 'self'
            ? frozenCodecRef(input)
            : namedOutputRef(descriptor.output, input),
        ...resultNullability(descriptor),
        lower: descriptor.lower,
      };
    },
    *values(): IterableIterator<SqlAggregateDescriptor> {
      yield* validated;
    },
  };
}

/**
 * Resolve the overload that answers a call carrying no input. Both kinds that qualify name their result codec outright, there being no input codec to reuse.
 */
function resolveWithoutInput(
  operation: string,
  descriptor: SqlAggregateDescriptor | undefined,
): ResolvedSqlAggregate | undefined {
  if (descriptor === undefined) return undefined;
  if (!isNoInputAggregateDescriptor(descriptor) && !isAnyInputAggregateDescriptor(descriptor)) {
    return undefined;
  }
  return {
    operation,
    output: namedOutputRef(descriptor.output, undefined),
    ...resultNullability(descriptor),
    lower: descriptor.lower,
  };
}

function describeCandidate(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'operation' in value) {
    return `'${String(value.operation)}'`;
  }
  return `of type ${typeof value}`;
}
