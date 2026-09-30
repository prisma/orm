import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import {
  type AuthoringContributions,
  temporalAuthoringPresets,
  temporalCodecPreset,
} from '@internal/framework-components/authoring';
import type { PslSpan } from '@internal/framework-components/psl-ast';
import { describe, expect, it } from 'vitest';
import { createPslDiagnosticCollector, diagnosticSource } from '../src/diagnostic';
import { reportUnknownFieldPreset } from '../src/field-presets';
import { parse } from '../src/parse';

const SPAN: PslSpan = {
  start: { offset: 0, line: 1, column: 1 },
  end: { offset: 0, line: 1, column: 1 },
};

const storage = { codecId: 'test/date@1', nativeType: 'date' } as const;
const temporal = {
  ...temporalAuthoringPresets(storage),
  timestamp: temporalCodecPreset(storage),
};

function unknownPresetMessage(
  field: AuthoringContributions['field'],
  helperPath: string,
): ContractSourceDiagnostic[] {
  const { document, sources } = parse('', 'schema.prisma');
  const diagnostics = createPslDiagnosticCollector(sources);
  reportUnknownFieldPreset({
    entityLabel: 'Field "Post.at"',
    namespace: helperPath.split('.')[0] ?? helperPath,
    helperPath,
    authoringContributions: { field } as AuthoringContributions,
    source: diagnosticSource(sources, document.syntax),
    span: SPAN,
    diagnostics,
  });
  return diagnostics.toExternal();
}

describe('the unknown field preset diagnostic', () => {
  it('lists the presets of the namespace', () => {
    expect(unknownPresetMessage({ temporal }, 'temporal.deletedAt')).toMatchObject([
      {
        code: 'PSL_UNKNOWN_FIELD_PRESET',
        message:
          'Field "Post.at" references unknown field preset "temporal.deletedAt". The "temporal" namespace has temporal.createdAt(), temporal.updatedAt() and temporal.timestamp(onCreate, onUpdate).',
      },
    ]);
  });

  it('lists the presets of nested namespaces when the namespace holds none directly', () => {
    expect(
      unknownPresetMessage({ ext: { clock: { created: temporal.createdAt } } }, 'ext.created'),
    ).toMatchObject([
      {
        message:
          'Field "Post.at" references unknown field preset "ext.created". The "ext" namespace has ext.clock.created().',
      },
    ]);
  });

  it('says so when the namespace holds no preset at any depth', () => {
    expect(unknownPresetMessage({ ext: { empty: {} } }, 'ext.created')).toMatchObject([
      {
        message:
          'Field "Post.at" references unknown field preset "ext.created". The "ext" namespace has no field presets.',
      },
    ]);
  });
});
