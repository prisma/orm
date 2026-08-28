/**
 * `PslDocumentAst.namespaces` is an array, so a producer can hand the printer
 * two entries sharing one name — a state a single `PslNamespace` cannot
 * represent, since it stores entities as `entries[kind][name]`. The printer
 * collapses them into one section, and these tests pin what "collapse" means
 * for each kind of content it carries.
 */
import type {
  PslAttribute,
  PslDocumentAst,
  PslExtensionBlock,
  PslModel,
  PslNamespace,
  PslSpan,
} from '@internal/framework-components/psl-ast';
import {
  makePslNamespace,
  makePslNamespaceEntries,
  UNSPECIFIED_PSL_NAMESPACE_ID,
} from '@internal/framework-components/psl-ast';
import { describe, expect, it } from 'vitest';
import { printPslFromAst } from '../src/print-psl';

const ZERO_SPAN: PslSpan = {
  start: { offset: 0, line: 1, column: 1 },
  end: { offset: 0, line: 1, column: 1 },
};

const ID_ATTRIBUTE: PslAttribute = {
  kind: 'attribute',
  target: 'field',
  name: 'id',
  args: [],
  span: ZERO_SPAN,
};

const BLOCK_DESCRIPTORS = {
  widget: {
    kind: 'pslBlock',
    keyword: 'widget',
    discriminator: 'widget',
    name: { required: true },
    parameters: {},
    variadicParameters: true,
  },
} as const;

function idModel(name: string): PslModel {
  return {
    kind: 'model',
    name,
    fields: [
      {
        kind: 'field',
        name: 'id',
        typeName: 'Int',
        optional: false,
        list: false,
        attributes: [ID_ATTRIBUTE],
        span: ZERO_SPAN,
      },
    ],
    attributes: [],
    span: ZERO_SPAN,
  };
}

function widgetBlock(name: string, member: string): PslExtensionBlock {
  return {
    kind: 'widget',
    keyword: 'widget',
    name,
    parameters: { [member]: { kind: 'value', raw: JSON.stringify(member), span: ZERO_SPAN } },
    blockAttributes: [],
    attributes: {},
    span: ZERO_SPAN,
  };
}

function bucket(
  name: string,
  models: readonly PslModel[],
  blocks: readonly PslExtensionBlock[],
): PslNamespace {
  return makePslNamespace({
    kind: 'namespace',
    name,
    entries: makePslNamespaceEntries(models, [], blocks),
    span: ZERO_SPAN,
  });
}

function document(namespaces: readonly PslNamespace[]): PslDocumentAst {
  return { kind: 'document', sourceId: 't', namespaces, span: ZERO_SPAN };
}

function print(ast: PslDocumentAst): string {
  return printPslFromAst(ast, { pslBlockDescriptors: BLOCK_DESCRIPTORS });
}

describe('two namespace entries sharing one name', () => {
  it('prints a model declared by both entries once, not twice', () => {
    const printed = print(
      document([
        bucket(UNSPECIFIED_PSL_NAMESPACE_ID, [idModel('Widget')], []),
        bucket(UNSPECIFIED_PSL_NAMESPACE_ID, [idModel('Widget')], []),
      ]),
    );
    expect(printed).toContain('model Widget {');
    expect(printed.match(/model Widget \{/g)).toHaveLength(1);
  });

  it('prints each model once when only one entry declares it', () => {
    const printed = print(
      document([
        bucket(UNSPECIFIED_PSL_NAMESPACE_ID, [idModel('Widget')], []),
        bucket(UNSPECIFIED_PSL_NAMESPACE_ID, [], []),
      ]),
    );
    expect(printed.match(/model Widget \{/g)).toHaveLength(1);
  });

  it('keeps the models of every entry, under one namespace block', () => {
    const printed = print(
      document([
        bucket('billing', [idModel('Invoice')], []),
        bucket('billing', [idModel('Payment')], []),
      ]),
    );
    expect(printed.match(/namespace billing \{/g)).toHaveLength(1);
    expect(printed).toContain('model Invoice {');
    expect(printed).toContain('model Payment {');
  });

  it('keeps the differently-named blocks of every entry', () => {
    const printed = print(
      document([
        bucket('billing', [], [widgetBlock('Paid', 'yes')]),
        bucket('billing', [], [widgetBlock('Unpaid', 'no')]),
      ]),
    );
    expect(printed.match(/namespace billing \{/g)).toHaveLength(1);
    expect(printed).toContain('widget Paid {');
    expect(printed).toContain('widget Unpaid {');
  });

  it('prints a block declared by both entries once, not twice', () => {
    const printed = print(
      document([
        bucket(UNSPECIFIED_PSL_NAMESPACE_ID, [], [widgetBlock('Status', 'draft')]),
        bucket(UNSPECIFIED_PSL_NAMESPACE_ID, [], [widgetBlock('Status', 'shipped')]),
      ]),
    );
    expect(printed.match(/widget Status \{/g)).toHaveLength(1);
  });
});

describe('two namespaces with different names declaring the same model name', () => {
  it('prints the model under each namespace, dropping neither', () => {
    const printed = print(
      document([
        bucket('billing', [idModel('Invoice')], []),
        bucket('shop', [idModel('Invoice')], []),
      ]),
    );
    expect(printed).toContain('namespace billing {');
    expect(printed).toContain('namespace shop {');
    expect(printed.match(/model Invoice \{/g)).toHaveLength(2);
  });
});

describe('namespace section order', () => {
  it('orders named namespaces by code point, independent of host locale', () => {
    // `B` is U+0042 and `a` is U+0061, so code point puts `B` first. Every ICU
    // collation puts `a` first, in every locale — so restoring `localeCompare`
    // fails this on any host. An accented pair would not: sv, fi, da, nb and
    // et collate `Ä` after `z`, agreeing with code point, so a `Ä`/`z` fixture
    // stays green under `localeCompare` on those hosts.
    const printed = print(
      document([bucket('a', [idModel('Lower')], []), bucket('B', [idModel('Upper')], [])]),
    );
    expect(printed).toContain('namespace a {');
    expect(printed).toContain('namespace B {');
    expect(printed.indexOf('namespace B {')).toBeLessThan(printed.indexOf('namespace a {'));
  });
});
