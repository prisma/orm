import type {
  ContractField,
  ContractModelBase,
  ContractRelation,
  ContractValueObject,
  ContractWithDomain,
} from '@internal/contract/types';
import { crossRef } from '@internal/contract/types';
import type { CliStructuredError } from '@internal/errors/control';
import type { Result } from '@internal/utils/result';
import { expect } from 'vitest';

interface ModelSpec {
  readonly fields?: readonly string[];
  readonly relations?: readonly string[];
  readonly base?: string;
}

interface NamespaceSpec {
  readonly models?: Record<string, ModelSpec>;
  readonly valueObjects?: Record<string, readonly string[]>;
}

const textField: ContractField = {
  nullable: false,
  type: { kind: 'scalar', codecId: 'test/text@1' },
};

function fieldsOf(names: readonly string[]): Record<string, ContractField> {
  return Object.fromEntries(names.map((name) => [name, textField]));
}

function modelOf(spec: ModelSpec): ContractModelBase {
  const relation: ContractRelation = {
    to: crossRef('Other'),
    cardinality: '1:N',
    on: { localFields: ['id'], targetFields: ['ownerId'] },
  };
  return {
    fields: fieldsOf(spec.fields ?? []),
    relations: Object.fromEntries((spec.relations ?? []).map((name) => [name, relation])),
    storage: {},
    ...(spec.base !== undefined ? { base: crossRef(spec.base) } : {}),
  };
}

function valueObjectOf(fields: readonly string[]): ContractValueObject {
  return { fields: fieldsOf(fields) };
}

export function contractOf(namespaces: Record<string, NamespaceSpec>): ContractWithDomain {
  return {
    domain: {
      namespaces: Object.fromEntries(
        Object.entries(namespaces).map(([id, ns]) => [
          id,
          {
            models: Object.fromEntries(
              Object.entries(ns.models ?? {}).map(([name, spec]) => [name, modelOf(spec)]),
            ),
            valueObjects: Object.fromEntries(
              Object.entries(ns.valueObjects ?? {}).map(([name, fields]) => [
                name,
                valueObjectOf(fields),
              ]),
            ),
          },
        ]),
      ),
    },
  };
}

export function expectFailure<T>(
  result: Result<T, CliStructuredError>,
  code: string,
  ...fragments: readonly string[]
): CliStructuredError {
  if (result.ok) {
    throw new Error(`Expected ${code}, got success: ${JSON.stringify(result.value)}`);
  }
  expect(result.failure.code).toBe(code);
  const text = `${result.failure.message}\n${result.failure.why ?? ''}\n${result.failure.fix ?? ''}`;
  for (const fragment of fragments) {
    expect(text).toContain(fragment);
  }
  if (code === 'MIGRATION.STATEMENT_INVALID' || code === 'MIGRATION.STATEMENT_UNRESOLVED') {
    expect(result.failure.nextActions?.map((action) => action.label)).toEqual([result.failure.fix]);
  }
  return result.failure;
}

export function expectValue<T>(result: Result<T, CliStructuredError>): T {
  if (!result.ok) {
    throw new Error(`Expected success, got ${result.failure.code}: ${result.failure.why}`);
  }
  return result.value;
}
