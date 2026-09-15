import { describe, expect, it } from 'vitest';
import {
  hasOperationPreview,
  hasPslContractInfer,
  hasPslContractPrint,
  hasSchemaView,
} from '../src/control/control-capabilities';
import type { ControlFamilyInstance } from '../src/control/control-instances';
import type { OperationPreview } from '../src/control/control-operation-preview';
import type { PslDocumentAst } from '../src/control/psl-ast';

const SYNTHETIC_AST: PslDocumentAst = {
  kind: 'document',
  sourceId: 'test',
  namespaces: [],
  span: {
    start: { offset: 0, line: 1, column: 1 },
    end: { offset: 0, line: 1, column: 1 },
  },
};

const baseInstance: ControlFamilyInstance<'sql', unknown> = {
  familyId: 'sql',
  deserializeContract: (raw: unknown) => raw as never,
  introspect: async () => ({}) as unknown,
} as unknown as ControlFamilyInstance<'sql', unknown>;

describe('hasPslContractInfer', () => {
  it('returns true when instance exposes inferPslContract function', () => {
    const instance = {
      ...baseInstance,
      inferPslContract: (_schemaIR: unknown) => SYNTHETIC_AST,
    } as ControlFamilyInstance<'sql', unknown>;

    expect(hasPslContractInfer(instance)).toBe(true);
  });

  it('returns false when instance does not declare inferPslContract', () => {
    expect(hasPslContractInfer(baseInstance)).toBe(false);
  });

  it('returns false when inferPslContract is present but not a function', () => {
    const instance = {
      ...baseInstance,
      inferPslContract: 'not a function',
    } as unknown as ControlFamilyInstance<'sql', unknown>;

    expect(hasPslContractInfer(instance)).toBe(false);
  });
});

describe('hasPslContractPrint', () => {
  it('returns true when instance exposes printPslContract function', () => {
    const instance = {
      ...baseInstance,
      printPslContract: (_contract: unknown) => SYNTHETIC_AST,
    } as ControlFamilyInstance<'sql', unknown>;

    expect(hasPslContractPrint(instance)).toBe(true);
  });

  it('returns false when instance does not declare printPslContract', () => {
    expect(hasPslContractPrint(baseInstance)).toBe(false);
  });

  it('returns false when printPslContract is present but not a function', () => {
    const instance = {
      ...baseInstance,
      printPslContract: 'not a function',
    } as unknown as ControlFamilyInstance<'sql', unknown>;

    expect(hasPslContractPrint(instance)).toBe(false);
  });
});

describe('hasSchemaView', () => {
  it('returns true when instance exposes toSchemaView function', () => {
    const instance = {
      ...baseInstance,
      toSchemaView: () => ({}) as never,
    } as ControlFamilyInstance<'sql', unknown>;

    expect(hasSchemaView(instance)).toBe(true);
  });

  it('returns false when instance does not declare toSchemaView', () => {
    expect(hasSchemaView(baseInstance)).toBe(false);
  });
});

describe('hasOperationPreview', () => {
  const SYNTHETIC_PREVIEW: OperationPreview = {
    statements: [{ text: 'CREATE TABLE x (id int)', language: 'sql' }],
  };

  it('returns true when instance exposes toOperationPreview function', () => {
    const instance = {
      ...baseInstance,
      toOperationPreview: () => SYNTHETIC_PREVIEW,
    } as ControlFamilyInstance<'sql', unknown>;

    expect(hasOperationPreview(instance)).toBe(true);
  });

  it('returns false when instance does not declare toOperationPreview', () => {
    expect(hasOperationPreview(baseInstance)).toBe(false);
  });

  it('returns false when toOperationPreview is present but not a function', () => {
    const instance = {
      ...baseInstance,
      toOperationPreview: 'not a function',
    } as unknown as ControlFamilyInstance<'sql', unknown>;

    expect(hasOperationPreview(instance)).toBe(false);
  });
});
