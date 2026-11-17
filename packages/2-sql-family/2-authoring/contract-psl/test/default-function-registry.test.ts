import type {
  ControlMutationDefaultEntry,
  TypedDefaultFunctionCall,
} from '@internal/framework-components/control';
import type { PslSpan } from '@internal/psl-parser';
import { diagnosticSource } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { describe, expect, it } from 'vitest';
import { lowerDefaultFunctionWithRegistry } from '../src/default-function-registry';
import { createBuiltinLikeControlMutationDefaults } from './fixtures';

function createSpan(overrides?: Partial<PslSpan['start']>): PslSpan {
  return {
    start: {
      offset: overrides?.offset ?? 0,
      line: overrides?.line ?? 1,
      column: overrides?.column ?? 1,
    },
    end: {
      offset: overrides?.offset ?? 0,
      line: overrides?.line ?? 1,
      column: overrides?.column ?? 1,
    },
  };
}

function call(fn: string, args: Record<string, unknown> = {}): TypedDefaultFunctionCall {
  return { fn, span: createSpan(), args };
}

const parsed = parse('', 'schema.prisma');
const source = diagnosticSource(parsed.sources, parsed.document.syntax);
const loweringContext = {
  sourceId: 'schema.prisma',
  modelName: 'User',
  fieldName: 'id',
} as const;

describe('default function registry', () => {
  const builtinRegistry = createBuiltinLikeControlMutationDefaults().defaultFunctionRegistry;

  it('lowers now() to a database default', () => {
    const loweredNow = lowerDefaultFunctionWithRegistry({
      call: call('now'),
      registry: builtinRegistry,
      context: loweringContext,
      source,
    });
    expect(loweredNow).toEqual({
      ok: true,
      value: { kind: 'storage', defaultValue: { kind: 'function', expression: 'now()' } },
    });
  });

  it('derives unknown-function supported list from registry keys', () => {
    const customRegistry = new Map<string, ControlMutationDefaultEntry>([
      [
        'custom',
        {
          lower: () => ({
            ok: true,
            value: {
              kind: 'storage',
              defaultValue: {
                kind: 'function',
                expression: 'custom()',
              },
            },
          }),
        },
      ],
    ]);

    const loweredUnknown = lowerDefaultFunctionWithRegistry({
      call: call('mystery'),
      registry: customRegistry,
      context: loweringContext,
      source,
    });

    expect(loweredUnknown.ok).toBe(false);
    if (loweredUnknown.ok) return;

    expect(loweredUnknown.diagnostic.message).toContain('Supported functions: custom().');
    expect(loweredUnknown.diagnostic.message).not.toContain('autoincrement()');
  });

  it('uses contributed usage signatures when provided', () => {
    const customRegistry = new Map<string, ControlMutationDefaultEntry>([
      [
        'custom',
        {
          lower: () => ({
            ok: true,
            value: {
              kind: 'storage',
              defaultValue: {
                kind: 'function',
                expression: 'custom()',
              },
            },
          }),
          usageSignatures: ['custom(size)'],
        },
      ],
    ]);

    const loweredUnknown = lowerDefaultFunctionWithRegistry({
      call: call('mystery'),
      registry: customRegistry,
      context: loweringContext,
      source,
    });

    expect(loweredUnknown.ok).toBe(false);
    if (loweredUnknown.ok) return;
    expect(loweredUnknown.diagnostic.message).toContain('custom(size)');
    expect(loweredUnknown.diagnostic.message).not.toContain('custom().');
  });

  it('lists only the database functions for an unknown function', () => {
    const loweredUnknown = lowerDefaultFunctionWithRegistry({
      call: call('uuidv7'),
      registry: builtinRegistry,
      context: loweringContext,
      source,
    });
    expect(loweredUnknown.ok).toBe(false);
    if (loweredUnknown.ok) return;

    expect(loweredUnknown.diagnostic.message).toBe(
      'Default function "uuidv7" is not supported in SQL PSL provider v1. Supported functions: autoincrement(), now().',
    );
  });
});
