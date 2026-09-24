import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import { expect, it, vi } from 'vitest';
import { lowerDefaultForField } from '../src/psl-column-resolution';
import { fixtureDataTypeSupport } from './fixture-data-types';
import { createPostgresTestContext } from './fixtures';

it('pushes owned default diagnostics with filename and range rather than a provider envelope', () => {
  const context = createPostgresTestContext();
  const { document, sources } = parse(
    'model User { id String @default(cuid(2)) }',
    'memory.prisma',
  );
  const { symbolTable } = buildSymbolTable({
    documents: [document],
    sources,
    pslBlockDescriptors: {},
  });
  const model = symbolTable.topLevel.models['User'];
  const field = model?.fields['id'];
  if (!model || !field) throw new Error('Missing fixture field');
  const diagnostics = {
    length: 0,
    push: vi.fn(),
    pushExternal: vi.fn(),
    pushUnlocated: vi.fn(),
    toExternal: () => [],
  };
  lowerDefaultForField({
    modelName: model.name,
    fieldName: field.name,
    field,
    model,
    symbolTable,
    sources,
    columnDescriptor: { codecId: 'pg/text@1', nativeType: 'text' },
    generatorDescriptorById: new Map(),
    defaultFunctionRegistry: new Map(),
    dataTypeSupport: fixtureDataTypeSupport,
    codecLookup: context.codecLookup,
    diagnostics,
  });
  expect(diagnostics.push).toHaveBeenCalledWith(
    expect.objectContaining({
      filename: 'memory.prisma',
      code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
      range: expect.any(Object),
    }),
  );
  expect(diagnostics.push.mock.calls[0]?.[0]).not.toHaveProperty('sourceId');
  expect(diagnostics.push.mock.calls[0]?.[0]).not.toHaveProperty('sourceFile');
  expect(diagnostics.pushExternal).not.toHaveBeenCalled();
});
