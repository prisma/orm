import type {
  AuthoringTypeChoiceDescriptor,
  AuthoringTypeConstructorDescriptor,
} from '@internal/framework-components/authoring';
import { EMPTY_GENERATOR_FUNCTIONS } from '@internal/framework-components/components';
import { EMPTY_DATA_TYPES } from '../src/attribute-spec/spec-context';
import { type BinderContext, createBinder, typeReferenceNode } from '../src/binder';
import { parse } from '../src/parse';
import { PslSources } from '../src/source-file';
import { buildSymbolTable } from '../src/symbol-table';

export const text: AuthoringTypeConstructorDescriptor = {
  kind: 'typeConstructor',
  output: { codecId: 'fixture/text@1' },
};

export const varchar: AuthoringTypeConstructorDescriptor = {
  kind: 'typeConstructor',
  args: [{ kind: 'value', dataType: 'fixture/int', name: 'length' }],
  output: { codecId: 'fixture/varchar@1' },
};

const tagged: AuthoringTypeConstructorDescriptor = {
  kind: 'typeConstructor',
  entityRefArg: { index: 0, entityKind: 'tag' },
  output: { codecId: 'fixture/tagged@1' },
};

const secondTagged: AuthoringTypeConstructorDescriptor = {
  kind: 'typeConstructor',
  entityRefArg: { index: 1, entityKind: 'tag' },
  output: { codecId: 'fixture/tagged@1' },
};

const wideDate: AuthoringTypeConstructorDescriptor = {
  kind: 'typeConstructor',
  output: { codecId: 'fixture/wide-date@1' },
};

const wideText: AuthoringTypeConstructorDescriptor = {
  kind: 'typeConstructor',
  output: { codecId: 'fixture/wide-text@1' },
};

const narrowDate: AuthoringTypeConstructorDescriptor = {
  kind: 'typeConstructor',
  output: { codecId: 'fixture/narrow-date@1' },
};

const moment: AuthoringTypeChoiceDescriptor = {
  kind: 'typeChoice',
  args: [
    { kind: 'option', name: 'as', values: ['date', 'text'], default: 'date', optional: true },
    {
      kind: 'option',
      name: 'storage',
      values: ['wide', 'narrow'],
      default: 'wide',
      optional: true,
    },
  ],
  choices: [
    { when: { as: 'date', storage: 'wide' }, type: 'WideDate' },
    { when: { as: 'text', storage: 'wide' }, type: 'WideText' },
    { when: { as: 'date', storage: 'narrow' }, type: 'NarrowDate' },
  ],
};

function context(): BinderContext {
  return {
    authoringContributions: {
      type: {
        String: text,
        Moment: moment,
        WideDate: wideDate,
        WideText: wideText,
        NarrowDate: narrowDate,
        db: { VarChar: varchar, tagged, secondTagged },
      },
      entityTypes: {},
      attributeSpecs: { model: {}, field: {} },
      modelAttributes: {},
      pslBlockDescriptors: {},
      dataTypes: {},
    },
    controlMutationDefaults: { defaultFunctionRegistry: new Map() },
    generatorFunctions: EMPTY_GENERATOR_FUNCTIONS,
    dataTypes: EMPTY_DATA_TYPES,
  };
}

export function bindProject(text: string) {
  const { document, sources } = parse(text, 'schema.prisma');
  const pslSources = new PslSources([[document.syntax, sources.sourceFileFor(document.syntax)]]);
  const { symbolTable } = buildSymbolTable({
    documents: [document],
    sources: pslSources,
    defaultNamespaceId: 'public',
  });
  const { binder, diagnostics } = createBinder({
    symbolTable,
    sources: pslSources,
    context: context(),
  });
  const resolve = (fieldName: string) => {
    const field = symbolTable.defaultNamespace.models['Post']?.fields[fieldName];
    const node = field === undefined ? undefined : typeReferenceNode(field);
    return node === undefined ? undefined : binder.symbolForNode(node);
  };
  return { resolve, diagnostics, binder, symbolTable, sources: pslSources };
}
