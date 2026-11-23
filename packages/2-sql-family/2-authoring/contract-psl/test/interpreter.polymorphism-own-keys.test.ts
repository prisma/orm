import { crossRef } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { fixtureInterpreterTypes } from './fixture-codec-descriptors';
import {
  createBuiltinLikeControlMutationDefaults,
  interpretSqlContract,
  postgresScalarTypeDescriptors,
  postgresTarget,
} from './fixtures';

function interpret(schema: string) {
  return interpretSqlContract(schema, {
    target: postgresTarget,
    scalarColumnDescriptors: postgresScalarTypeDescriptors,
    composedExtensionContracts: new Map(),
    createNamespace: createTestSqlNamespace,
    ...fixtureInterpreterTypes,
    capabilities: { sql: { scalarList: true } },
    controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
  });
}

function taskWithVariantValues(first: string, second: string): string {
  return `model Task {
  id   Int    @id
  type String
  @@discriminator(type)
}

model Bug {
  severity String
  @@base(Task, "${first}")
}

model Feature {
  priority Int
  @@base(Task, "${second}")
}`;
}

describe('discriminator values named like properties every object has', () => {
  it('keeps a variant whose value is constructor', () => {
    const result = interpret(taskWithVariantValues('constructor', 'toString'));
    if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));
    const variants = result.value.domain.namespaces['public']?.models['Task']?.variants;
    expect(variants).toEqual({
      constructor: crossRef('Bug', 'public'),
      toString: crossRef('Feature', 'public'),
    });
  });

  it('keeps a variant whose value is __proto__ as an own key', () => {
    const result = interpret(taskWithVariantValues('__proto__', 'feature'));
    const outcome = result.ok
      ? {
          ok: true,
          ownProto: Object.hasOwn(
            result.value.domain.namespaces['public']?.models['Task']?.variants ?? {},
            '__proto__',
          ),
        }
      : { ok: false, codes: result.failure.diagnostics.map((d) => d.code) };
    expect(outcome).toEqual({ ok: true, ownProto: true });
  });
});
