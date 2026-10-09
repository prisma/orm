import type {
  AuthoringTypeConstructorDescriptor,
  AuthoringTypeNamespace,
} from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import { blockAttribute } from '../src/attribute-spec/block-attribute';
import { entityRef } from '../src/attribute-spec/combinators/entity-ref';
import { fieldRef } from '../src/attribute-spec/combinators/field-ref';
import { list } from '../src/attribute-spec/combinators/list';
import { fieldAttribute } from '../src/attribute-spec/field-attribute';
import { modelAttribute } from '../src/attribute-spec/model-attribute';
import type {
  AttributeSpecContext,
  AttributeSpecNamespace,
  FieldAttributeSpecContext,
} from '../src/attribute-spec/spec-context';
import {
  createBinder,
  type DescribeUnresolvedType,
  type DescribeUnsupportedAttribute,
  typeReferenceNode,
  type UnresolvedTypeReference,
  type UnsupportedAttribute,
} from '../src/binder';
import { mapBlock } from '../src/block-spec/constructors';
import { parse } from '../src/parse';
import type { ResolvedAttribute } from '../src/resolve';
import { PslSources, type Range } from '../src/source-file';
import { buildSymbolTable } from '../src/symbol-table';
import type { MixinInclusionAst } from '../src/syntax/ast/declarations';
import { ArrayLiteralAst } from '../src/syntax/ast/expressions';
import type { SyntaxNode } from '../src/syntax/red';
import { binderContext } from './support';

const scalar: AuthoringTypeConstructorDescriptor = {
  kind: 'typeConstructor',
  output: { codecId: 'fixture/scalar@1' },
};

const TYPE_CONSTRUCTORS: AuthoringTypeNamespace = { String: scalar, Int: scalar };

const fieldList = (name: string) =>
  modelAttribute(name, {
    documentation: 'fixture',
    positional: [{ key: 'fields', type: list(fieldRef()), documentation: 'fixture' }],
  });

interface BindOptions {
  readonly fieldSpecs?: AttributeSpecNamespace['field'];
  readonly modelSpecs?: AttributeSpecNamespace['model'];
  readonly describeUnsupportedAttribute?: DescribeUnsupportedAttribute;
  readonly describeUnresolvedType?: DescribeUnresolvedType;
}

function bindWith(options: BindOptions, ...texts: string[]) {
  const parsed = texts.map((text, index) => parse(text, `${index}.psl`));
  const sources = new PslSources(
    parsed.map(
      ({ document, sources }) => [document.syntax, sources.sourceFileFor(document.syntax)] as const,
    ),
  );
  const table = buildSymbolTable({ documents: parsed.map(({ document }) => document), sources });
  return {
    topLevel: table.symbolTable.topLevel,
    tableDiagnostics: table.diagnostics,
    ...createBinder({
      sources,
      symbolTable: table.symbolTable,
      context: binderContext({
        contributedTypes: TYPE_CONSTRUCTORS,
        attributeSpecs: {
          model: {
            index: () => fieldList('index'),
            unique: () => fieldList('unique'),
            ...options.modelSpecs,
          },
          field: {
            id: () => fieldAttribute('id', { documentation: 'fixture' }),
            ...options.fieldSpecs,
          },
        },
        pslBlockDescriptors: {
          policy: {
            kind: 'pslBlock',
            keyword: 'policy',
            discriminator: 'policy',
            name: { required: true },
            spec: () =>
              mapBlock({ value: { type: entityRef({ kind: 'model' }), documentation: 'target' } }),
            attributes: {
              refs: () =>
                blockAttribute('refs', {
                  documentation: 'fixture',
                  positional: [
                    { key: 'target', type: entityRef({ kind: 'model' }), documentation: 'target' },
                  ],
                }),
            },
          },
        },
        ...(options.describeUnsupportedAttribute === undefined
          ? {}
          : { describeUnsupportedAttribute: options.describeUnsupportedAttribute }),
        ...(options.describeUnresolvedType === undefined
          ? {}
          : { describeUnresolvedType: options.describeUnresolvedType }),
      }),
    }),
  };
}

function bind(...texts: string[]) {
  return bindWith({}, ...texts);
}

function lines(...parts: string[]): string {
  return parts.join('\n');
}

function firstListElement(attribute: ResolvedAttribute | undefined, index = 0): SyntaxNode {
  const expression = attribute?.args[0]?.expression;
  const element = expression === undefined ? undefined : ArrayLiteralAst.cast(expression.syntax);
  const node = Array.from(element?.elements() ?? [])[index]?.syntax;
  if (node === undefined) throw new Error('the attribute has no list element');
  return node;
}

function rangeOf(source: string, snippet: string, occurrence = 0): Range {
  let offset = -1;
  for (let found = 0; found <= occurrence; found++) offset = source.indexOf(snippet, offset + 1);
  if (offset < 0) throw new Error(`"${snippet}" is not in the source`);
  const before = source.slice(0, offset).split('\n');
  const line = before.length - 1;
  const character = before[line]?.length ?? 0;
  return { start: { line, character }, end: { line, character: character + snippet.length } };
}

function inclusionsOf(holder: {
  readonly node: { inclusions(): Iterable<MixinInclusionAst> };
}): MixinInclusionAst[] {
  return Array.from(holder.node.inclusions());
}

describe('createBinder — a mixin declaration', () => {
  it('is the declared symbol of its node, at the top level and in a namespace', () => {
    const { binder, topLevel } = bind(
      'model mixin Timestamps {\n  createdAt Int\n}\nnamespace auth {\n  enum mixin BaseRoles {\n    ADMIN\n  }\n}',
    );
    const timestamps = topLevel.mixins['Timestamps']!;
    const auth = topLevel.namespaces['auth']!;
    const baseRoles = auth.mixins['BaseRoles']!;

    expect(binder.declaredSymbol(timestamps.node.syntax)).toBe(timestamps);
    expect(binder.declaredSymbol(baseRoles.node.syntax)).toBe(baseRoles);
    expect(binder.symbolForNode(timestamps.node.name()!.syntax)).toEqual({
      kind: 'mixin',
      symbol: timestamps,
    });
    expect(binder.symbolForNode(baseRoles.node.name()!.syntax)).toEqual({
      kind: 'mixin',
      symbol: baseRoles,
      namespace: auth,
    });
  });
});

describe('createBinder — the name of an inclusion', () => {
  it('resolves an unqualified name to the mixin', () => {
    const { binder, topLevel, diagnostics } = bind(
      'model mixin Timestamps {\n  createdAt Int\n}\nmodel User {\n  id Int\n  +Timestamps\n}',
    );
    const [inclusion] = inclusionsOf(topLevel.models['User']!);

    expect(diagnostics).toEqual([]);
    expect(binder.symbolForNode(inclusion!.name()!.syntax)).toEqual({
      kind: 'mixin',
      symbol: topLevel.mixins['Timestamps'],
    });
  });

  it('resolves a qualified name to the mixin and its qualifier to the namespace', () => {
    const { binder, topLevel, diagnostics } = bind(
      'namespace auth {\n  model mixin Timestamps {\n    createdAt Int\n  }\n}\nmodel User {\n  +auth.Timestamps\n}',
    );
    const auth = topLevel.namespaces['auth']!;
    const name = inclusionsOf(topLevel.models['User']!)[0]!.name()!;

    expect(diagnostics).toEqual([]);
    expect(binder.symbolForNode(name.syntax)).toEqual({
      kind: 'mixin',
      symbol: auth.mixins['Timestamps'],
      namespace: auth,
    });
    expect(binder.symbolForNode(name.namespace()!.syntax)).toEqual({
      kind: 'namespace',
      symbol: auth,
    });
  });

  it('resolves a name through the namespace of the including block before the top level', () => {
    const { binder, topLevel } = bind(
      'enum mixin R {\n  TOP\n}\nnamespace auth {\n  enum mixin R {\n    ADMIN\n  }\n  enum Role {\n    +R\n  }\n}\nenum Role {\n  +R\n}',
    );
    const auth = topLevel.namespaces['auth']!;

    expect(binder.symbolForNode(inclusionsOf(auth.blocks['Role']!)[0]!.name()!.syntax)).toEqual({
      kind: 'mixin',
      symbol: auth.mixins['R'],
      namespace: auth,
    });
    expect(binder.symbolForNode(inclusionsOf(topLevel.blocks['Role']!)[0]!.name()!.syntax)).toEqual(
      { kind: 'mixin', symbol: topLevel.mixins['R'] },
    );
  });

  it('resolves the name of an inclusion in a composite type and in another document', () => {
    const { binder, topLevel, diagnostics } = bind(
      'type Address {\n  +Geo\n}',
      'type mixin Geo {\n  lat Int\n}',
    );

    expect(diagnostics).toEqual([]);
    expect(
      binder.symbolForNode(inclusionsOf(topLevel.compositeTypes['Address']!)[0]!.name()!.syntax),
    ).toEqual({ kind: 'mixin', symbol: topLevel.mixins['Geo'] });
  });

  it('still resolves a name the symbol table refused for its keyword or for a repeat', () => {
    const { binder, topLevel, diagnostics, tableDiagnostics } = bind(
      'enum mixin R {\n  A\n}\nmodel mixin T {\n  a Int\n}\nmodel User {\n  +R\n  +T\n  +T\n}',
    );
    const resolved = inclusionsOf(topLevel.models['User']!).map((inclusion) =>
      binder.symbolForNode(inclusion.name()!.syntax),
    );

    expect(tableDiagnostics).toHaveLength(2);
    expect(diagnostics).toEqual([]);
    expect(resolved).toEqual([
      { kind: 'mixin', symbol: topLevel.mixins['R'] },
      { kind: 'mixin', symbol: topLevel.mixins['T'] },
      { kind: 'mixin', symbol: topLevel.mixins['T'] },
    ]);
  });

  it('records a name the symbol table could not place as unresolved, with no second diagnostic', () => {
    const { binder, topLevel, diagnostics, tableDiagnostics } = bind(
      'model Target {\n  id Int\n}\nnamespace ns {\n}\nmodel User {\n  +Missing\n  +Target\n  +other:T\n  +ns.Missing\n  +nowhere.T\n}',
    );
    const names = inclusionsOf(topLevel.models['User']!).map((inclusion) => inclusion.name()!);

    expect(tableDiagnostics).toHaveLength(5);
    expect(diagnostics).toEqual([]);
    expect(names.map((name) => binder.symbolForNode(name.syntax))).toEqual([
      { kind: 'unresolved', name: 'Missing' },
      { kind: 'unresolved', name: 'Target' },
      { kind: 'unresolved', name: 'other:T' },
      { kind: 'unresolved', name: 'ns.Missing' },
      { kind: 'unresolved', name: 'nowhere.T' },
    ]);
    expect(binder.symbolForNode(names[3]!.namespace()!.syntax)).toEqual({
      kind: 'namespace',
      symbol: topLevel.namespaces['ns'],
    });
    expect(binder.symbolForNode(names[4]!.namespace()!.syntax)).toBeUndefined();
  });
});

describe('createBinder — a mixin name in type position', () => {
  it('rejects a field typed with a mixin, at the type name', () => {
    const source =
      'model mixin Timestamps {\n  createdAt Int\n}\nmodel User {\n  id Int\n  stamps Timestamps\n}';
    const { binder, topLevel, diagnostics } = bind(source);

    expect(diagnostics).toEqual([
      {
        code: 'PSL_UNRESOLVED_REFERENCE',
        message:
          '"Timestamps" is a mixin; a type reference must name a model, composite type, enum, or named type',
        data: { reference: 'type', name: 'Timestamps', constructorCall: false },
        filename: '0.psl',
        range: rangeOf(source, 'Timestamps', 1),
      },
    ]);
    expect(
      binder.symbolForNode(typeReferenceNode(topLevel.models['User']!.fields['stamps']!)!),
    ).toEqual({ kind: 'mixin', symbol: topLevel.mixins['Timestamps'] });
  });

  it('rejects a field typed with a qualified mixin name', () => {
    const source =
      'namespace auth {\n  model mixin Timestamps {\n  }\n}\nmodel User {\n  stamps auth.Timestamps\n}';
    const { diagnostics } = bind(source);

    expect(diagnostics.map(({ code, message, range }) => ({ code, message, range }))).toEqual([
      {
        code: 'PSL_UNRESOLVED_REFERENCE',
        message:
          '"auth.Timestamps" is a mixin; a type reference must name a model, composite type, enum, or named type',
        range: rangeOf(source, 'auth.Timestamps'),
      },
    ]);
  });

  it('rejects a named type whose base is a mixin, at the base name', () => {
    const source = 'model mixin Timestamps {\n}\ntypes {\n  Stamps = Timestamps\n}';
    const { diagnostics } = bind(source);

    expect(
      diagnostics.map(({ code, message, filename, range }) => ({ code, message, filename, range })),
    ).toEqual([
      {
        code: 'PSL_UNRESOLVED_REFERENCE',
        message:
          '"Timestamps" is a mixin; a type reference must name a model, composite type, enum, or named type',
        filename: '0.psl',
        range: rangeOf(source, 'Timestamps', 1),
      },
    ]);
  });
});

describe('createBinder — binding a mixin body once', () => {
  it('resolves the type of a mixin field in the namespace of the mixin', () => {
    const { binder, topLevel, diagnostics } = bind(
      lines(
        'namespace auth {',
        '  model User {',
        '    id Int',
        '  }',
        '  model mixin Owned {',
        '    owner User',
        '  }',
        '}',
        'namespace billing {',
        '  model User {',
        '    id Int',
        '  }',
        '  model Invoice {',
        '    id Int',
        '    +auth.Owned',
        '  }',
        '}',
        'model User {',
        '  id Int',
        '}',
        'model Order {',
        '  +auth.Owned',
        '}',
      ),
    );
    const auth = topLevel.namespaces['auth']!;
    const expected = { kind: 'model', symbol: auth.models['User'], namespace: auth };
    const invoice = topLevel.namespaces['billing']!.models['Invoice']!;

    expect(diagnostics).toEqual([]);
    expect(binder.symbolForNode(typeReferenceNode(invoice.fields['owner']!)!)).toEqual(expected);
    expect(
      binder.symbolForNode(typeReferenceNode(topLevel.models['Order']!.fields['owner']!)!),
    ).toEqual(expected);
  });

  it('reports a mixin field with an unresolved type once, however many models include the mixin', () => {
    const source = lines(
      'model mixin T {',
      '  thing Nope',
      '}',
      'model A {',
      '  +T',
      '}',
      'model B {',
      '  +T',
      '}',
      'model C {',
      '  +T',
      '}',
    );
    const { diagnostics } = bind(source);

    expect(
      diagnostics.map(({ code, message, filename, range }) => ({ code, message, filename, range })),
    ).toEqual([
      {
        code: 'PSL_UNRESOLVED_REFERENCE',
        message: 'Cannot find type "Nope"',
        filename: '0.psl',
        range: rangeOf(source, 'Nope'),
      },
    ]);
  });

  it('reports a mixin attribute that names a field the mixin does not declare once, in the mixin', () => {
    const source = lines(
      'model mixin T {',
      '  a Int',
      '  @@index([a, id])',
      '}',
      'model A {',
      '  id Int',
      '  +T',
      '}',
      'model B {',
      '  id Int',
      '  +T',
      '}',
    );
    const { binder, topLevel, diagnostics } = bind(source);
    const mixin = topLevel.mixins['T']!;

    expect(
      diagnostics.map(({ code, message, filename, range }) => ({ code, message, filename, range })),
    ).toEqual([
      {
        code: 'PSL_UNRESOLVED_REFERENCE',
        message: 'Cannot find field "id" on "T"',
        filename: '0.psl',
        range: rangeOf(source, 'id', 0),
      },
    ]);
    expect(binder.symbolForNode(firstListElement(mixin.attributes[0]))).toEqual({
      kind: 'field',
      symbol: mixin.fields['a'],
    });
  });

  it('resolves a field named by an attribute of the including model to the field symbol of the mixin', () => {
    const { binder, topLevel, diagnostics } = bind(
      lines(
        'model mixin Tenant {',
        '  tenantId Int',
        '}',
        'model User {',
        '  +Tenant',
        '  id Int',
        '  @@unique([tenantId, id])',
        '}',
      ),
    );
    const user = topLevel.models['User']!;
    const tenantId = topLevel.mixins['Tenant']!.fields['tenantId']!;
    const unique = user.attributes.find((attribute) => attribute.name === 'unique');
    const resolution = binder.symbolForNode(firstListElement(unique, 0));

    expect(diagnostics).toEqual([]);
    expect(resolution).toEqual({ kind: 'field', symbol: tenantId });
    expect(resolution?.kind === 'field' ? resolution.symbol : undefined).toBe(tenantId);
    expect(binder.declaredSymbol(tenantId.node.syntax)).toBe(tenantId);
    expect(binder.symbolForNode(firstListElement(unique, 1))).toEqual({
      kind: 'field',
      symbol: user.fields['id'],
    });
  });

  it('binds a mixin that nothing includes and reports its diagnostics', () => {
    const { binder, topLevel, diagnostics } = bind(
      lines(
        'namespace auth {',
        '  model User {',
        '    id Int',
        '  }',
        '  model mixin Unused {',
        '    owner User',
        '    thing Nope',
        '    @@index([owner, missing])',
        '  }',
        '}',
      ),
    );
    const auth = topLevel.namespaces['auth']!;
    const mixin = auth.mixins['Unused']!;

    expect(diagnostics.map(({ message }) => message)).toEqual([
      'Cannot find type "Nope"',
      'Cannot find field "missing" on "Unused"',
    ]);
    expect(binder.symbolForNode(typeReferenceNode(mixin.fields['owner']!)!)).toEqual({
      kind: 'model',
      symbol: auth.models['User'],
      namespace: auth,
    });
    expect(binder.declaredSymbol(mixin.fields['owner']!.node.syntax)).toBe(mixin.fields['owner']);
    expect(binder.symbolForNode(mixin.fields['owner']!.node.name()!.syntax)).toEqual({
      kind: 'field',
      symbol: mixin.fields['owner'],
    });
    expect(binder.symbolForNode(firstListElement(mixin.attributes[0]))).toEqual({
      kind: 'field',
      symbol: mixin.fields['owner'],
    });
  });

  it('builds the attribute specs of a mixin with the mixin as the model, once', () => {
    const modelContexts: AttributeSpecContext[] = [];
    const fieldContexts: FieldAttributeSpecContext[] = [];
    const { topLevel, diagnostics } = bindWith(
      {
        modelSpecs: {
          watched: (ctx) => {
            modelContexts.push(ctx);
            return fieldList('watched');
          },
        },
        fieldSpecs: {
          contextual: (ctx) => {
            fieldContexts.push(ctx);
            return fieldAttribute('contextual', { documentation: 'fixture' });
          },
        },
      },
      lines(
        'namespace auth {',
        '  model User {',
        '    id Int',
        '  }',
        '  model mixin Owned {',
        '    owner User @contextual',
        '    @@watched([owner])',
        '  }',
        '}',
        'model User {',
        '  id Int',
        '}',
        'model A {',
        '  +auth.Owned',
        '  own Int @contextual',
        '  @@watched([owner, own])',
        '}',
        'model B {',
        '  +auth.Owned',
        '}',
      ),
    );
    const auth = topLevel.namespaces['auth']!;
    const mixin = auth.mixins['Owned']!;
    const a = topLevel.models['A']!;

    expect(diagnostics).toEqual([]);
    expect(modelContexts.map((ctx) => ctx.model)).toEqual([a, mixin]);
    expect(fieldContexts.map((ctx) => [ctx.model, ctx.field])).toEqual([
      [a, a.fields['own']],
      [mixin, mixin.fields['owner']],
    ]);
    expect(fieldContexts[1]?.typeResolution).toEqual({
      kind: 'model',
      symbol: auth.models['User'],
      namespace: auth,
    });
  });

  it('passes the mixin as the owner to the unsupported-attribute and unresolved-type callbacks, once', () => {
    const unsupported: UnsupportedAttribute[] = [];
    const unresolved: UnresolvedTypeReference[] = [];
    const { topLevel } = bindWith(
      {
        describeUnsupportedAttribute: (seen) => {
          unsupported.push(seen);
          return undefined;
        },
        describeUnresolvedType: (seen) => {
          unresolved.push(seen);
          return undefined;
        },
      },
      lines(
        'model mixin T {',
        '  a Nope @bogus',
        '  @@nope',
        '}',
        'model A {',
        '  +T',
        '  b Int @other',
        '}',
        'model B {',
        '  +T',
        '}',
      ),
    );
    const mixin = topLevel.mixins['T']!;
    const a = topLevel.models['A']!;

    expect(
      unsupported.map(({ attribute, level, owner, field }) => [
        attribute.name,
        level,
        owner,
        field,
      ]),
    ).toEqual([
      ['other', 'field', a, a.fields['b']],
      ['nope', 'model', mixin, undefined],
      ['bogus', 'field', mixin, mixin.fields['a']],
    ]);
    expect(unresolved.map(({ field, owner, written }) => [field, owner, written])).toEqual([
      [mixin.fields['a'], mixin, 'Nope'],
    ]);
  });

  it('binds a type mixin as it binds a composite type', () => {
    const body = ['  lat Nope @id @bogus', '  @@index([missing])', '  @@nope'];
    const describe = () => {
      const seen: (readonly [string, string, string])[] = [];
      const callback: DescribeUnsupportedAttribute = ({ attribute, level, owner }) => {
        seen.push([attribute.name, level, owner.kind]);
        return undefined;
      };
      return { seen, callback };
    };
    const forComposite = describe();
    const forMixin = describe();
    const composite = bindWith(
      { describeUnsupportedAttribute: forComposite.callback },
      lines('type Geo {', ...body, '}'),
    );
    const mixin = bindWith(
      { describeUnsupportedAttribute: forMixin.callback },
      lines('type mixin Geo {', ...body, '}', 'type A {', '  +Geo', '}', 'type B {', '  +Geo', '}'),
    );

    expect(mixin.diagnostics.map(({ message }) => message)).toEqual(
      composite.diagnostics.map(({ message }) => message),
    );
    expect(mixin.diagnostics.map(({ message }) => message)).toEqual(['Cannot find type "Nope"']);
    expect(forComposite.seen).toEqual([
      ['nope', 'model', 'compositeType'],
      ['bogus', 'field', 'compositeType'],
    ]);
    expect(forMixin.seen).toEqual([
      ['nope', 'model', 'mixin'],
      ['bogus', 'field', 'mixin'],
    ]);
  });
});

describe('createBinder — binding a key = value mixin once', () => {
  it('binds its entries and attributes in the namespace of the mixin, against the block descriptor', () => {
    const { binder, topLevel, diagnostics } = bind(
      lines(
        'namespace auth {',
        '  model Later {',
        '  }',
        '  policy mixin Shared {',
        '    target = Later',
        '    @@refs(Later)',
        '  }',
        '}',
        'model Later {',
        '}',
        'policy Root {',
        '  +auth.Shared',
        '  own = Later',
        '}',
      ),
    );
    const auth = topLevel.namespaces['auth']!;
    const mixin = auth.mixins['Shared']!;
    const root = topLevel.blocks['Root']!;
    const authLater = { kind: 'model', symbol: auth.models['Later'], namespace: auth };

    expect(diagnostics).toEqual([]);
    expect(root.entries.map((entry) => binder.symbolForNode(entry.value()!.syntax))).toEqual([
      authLater,
      { kind: 'model', symbol: topLevel.models['Later'] },
    ]);
    expect(binder.symbolForNode(mixin.attributes[0]!.args[0]!.expression!.syntax)).toEqual(
      authLater,
    );
  });

  it('reports an unresolved name in a mixin entry once, and binds a mixin nothing includes', () => {
    const source = lines(
      'policy mixin Shared {',
      '  target = Missing',
      '}',
      'policy mixin Unused {',
      '  target = Absent',
      '}',
      'policy A {',
      '  +Shared',
      '}',
      'policy B {',
      '  +Shared',
      '  own = Gone',
      '}',
    );
    const { diagnostics } = bind(source);

    expect(diagnostics.map(({ code, message, range }) => ({ code, message, range }))).toEqual([
      {
        code: 'PSL_UNRESOLVED_REFERENCE',
        message: 'Cannot find entity "Gone"',
        range: rangeOf(source, 'Gone'),
      },
      {
        code: 'PSL_UNRESOLVED_REFERENCE',
        message: 'Cannot find entity "Missing"',
        range: rangeOf(source, 'Missing'),
      },
      {
        code: 'PSL_UNRESOLVED_REFERENCE',
        message: 'Cannot find entity "Absent"',
        range: rangeOf(source, 'Absent'),
      },
    ]);
  });
});
