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
  /** The field's codec or the value object of its namespace it holds, and whether it is optional, for a field `fields` lists; text and required otherwise. */
  readonly fieldTypes?: Readonly<
    Record<
      string,
      { readonly codecId?: string; readonly valueObject?: string; readonly nullable?: boolean }
    >
  >;
}

interface NamespaceSpec {
  readonly models?: Record<string, ModelSpec>;
  readonly valueObjects?: Record<string, readonly string[]>;
  /** Each enum's member names; a member stores its name in lower case. */
  readonly enums?: Record<string, readonly string[]>;
}

const textField: ContractField = {
  nullable: false,
  type: { kind: 'scalar', codecId: 'test/text@1' },
};

function fieldsOf(
  namespaceId: string,
  names: readonly string[],
  types: ModelSpec['fieldTypes'] = {},
): Record<string, ContractField> {
  return Object.fromEntries(
    names.map((name) => {
      const type = types[name];
      return [
        name,
        type === undefined
          ? textField
          : {
              nullable: type.nullable ?? false,
              type:
                type.valueObject === undefined
                  ? { kind: 'scalar', codecId: type.codecId ?? 'test/text@1' }
                  : {
                      kind: 'valueObject',
                      plane: 'storage',
                      namespaceId,
                      entityKind: 'valueObject',
                      entityName: type.valueObject,
                    },
            },
      ];
    }),
  );
}

function modelOf(namespaceId: string, spec: ModelSpec): ContractModelBase {
  const relation: ContractRelation = {
    to: crossRef('Other'),
    cardinality: '1:N',
    on: { localFields: ['id'], targetFields: ['ownerId'] },
  };
  return {
    fields: fieldsOf(namespaceId, spec.fields ?? [], spec.fieldTypes),
    relations: Object.fromEntries((spec.relations ?? []).map((name) => [name, relation])),
    storage: {},
    ...(spec.base !== undefined ? { base: crossRef(spec.base) } : {}),
  };
}

function valueObjectOf(fields: readonly string[]): ContractValueObject {
  return {
    fields: Object.fromEntries(
      fields.map((name) => [
        name,
        { nullable: false, type: { kind: 'scalar', codecId: 'test/text@1' } },
      ]),
    ),
  };
}

export function contractOf(namespaces: Record<string, NamespaceSpec>): ContractWithDomain {
  const entries = Object.entries(namespaces);
  return {
    domain: {
      namespaces: Object.fromEntries(
        entries.map(([id, ns]) => [
          id,
          {
            models: Object.fromEntries(
              Object.entries(ns.models ?? {}).map(([name, spec]) => [name, modelOf(id, spec)]),
            ),
            ...(ns.enums === undefined
              ? {}
              : {
                  enum: Object.fromEntries(
                    Object.entries(ns.enums).map(([name, members]) => [
                      name,
                      {
                        codecId: 'test/text@1',
                        members: members.map((member) => ({
                          name: member,
                          value: member.toLowerCase(),
                        })),
                      },
                    ]),
                  ),
                }),
          },
        ]),
      ),
    },
    storage: {
      namespaces: Object.fromEntries(
        entries.map(([id, ns]) => [
          id,
          {
            id,
            entries: {
              valueObject: Object.fromEntries(
                Object.entries(ns.valueObjects ?? {}).map(([name, fields]) => [
                  name,
                  valueObjectOf(fields),
                ]),
              ),
            },
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
