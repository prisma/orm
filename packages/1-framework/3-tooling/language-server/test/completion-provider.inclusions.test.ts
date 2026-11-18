import { describe, expect, it } from 'vitest';
import { CompletionItemKind } from 'vscode-languageserver';
import {
  completeWithSource,
  completionItemByLabel,
  pslBlockDescriptors,
} from './helpers/completion-provider';

describe('providePslCompletionItems — after the plus of an inclusion', () => {
  const mixinsOf = (prefix: string, indent: string) =>
    [
      `model mixin ${prefix}Stamps {`,
      '}',
      `type mixin ${prefix}Geo {`,
      '}',
      `enum mixin ${prefix}Roles {`,
      '}',
      `policy mixin ${prefix}Policy {`,
      '}',
    ].map((line) => `${indent}${line}`);

  function after(block: readonly string[], placement: 'billing' | 'top' = 'billing') {
    const namespace = placement === 'top' ? undefined : placement;
    const blockLines =
      namespace === undefined ? block : block.map((line) => (line === '' ? line : `  ${line}`));
    const markedSource = [
      ...mixinsOf('Top', ''),
      ...(namespace === undefined ? blockLines : []),
      'namespace auth {',
      ...mixinsOf('Auth', '  '),
      '}',
      'namespace billing {',
      ...mixinsOf('Billing', '  '),
      '  model mixin Used {',
      '  }',
      ...(namespace === undefined ? [] : blockLines),
      '}',
    ].join('\n');
    return completeWithSource({ markedSource, pslBlockDescriptors });
  }

  const offered = (block: readonly string[], placement: 'billing' | 'top' = 'billing') =>
    after(block, placement)
      .items.map(({ label, detail }) => [label, detail])
      .sort();

  const namespaces = [
    ['auth', 'Namespace'],
    ['billing', 'Namespace'],
    ['public', 'Namespace'],
  ];

  it.each([
    ['a model', ['model Invoice {', '  id Int', '  +Used', '  +|', '}'], 'Stamps', 'model mixin'],
    ['a composite type', ['type Address {', '  +|', '  street String', '}'], 'Geo', 'type mixin'],
    ['an enum', ['enum Role {', '  +|', '  GUEST', '}'], 'Roles', 'enum mixin'],
    ['a struct block', ['policy P {', '  +|', '}'], 'Policy', 'policy mixin'],
  ])(
    'offers the mixins of the keyword that an unqualified name reaches, and each namespace, in %s',
    (_block, lines, suffix, detail) => {
      expect(offered(lines)).toEqual(
        [[`Billing${suffix}`, detail], [`Top${suffix}`, detail], ...namespaces].sort(),
      );
    },
  );

  it('offers the same while a name is being typed after the plus', () => {
    expect(offered(['model Invoice {', '  +Bil|', '}'])).toEqual(
      offered(['model Invoice {', '  +|', '}']),
    );
  });

  it('offers only top-level mixins of the keyword and each namespace in a top-level block', () => {
    expect(offered(['enum Role {', '  +|', '}'], 'top')).toEqual(
      [['TopRoles', 'enum mixin'], ...namespaces].sort(),
    );
  });

  it.each([
    ['a model', ['model Invoice {', '  +auth.|', '}'], [['AuthStamps', 'model mixin']]],
    ['a composite type', ['type Address {', '  +auth.|', '}'], [['AuthGeo', 'type mixin']]],
    ['an enum', ['enum Role {', '  +auth.|', '}'], [['AuthRoles', 'enum mixin']]],
    ['a struct block', ['policy P {', '  +auth.|', '}'], [['AuthPolicy', 'policy mixin']]],
  ])(
    'offers the mixins of the keyword in the named namespace after a qualifier, in %s',
    (_block, lines, expected) => {
      expect(offered(lines)).toEqual(expected);
      expect(offered(lines.map((line) => line.replace('auth.|', 'auth.Au|')))).toEqual(expected);
    },
  );

  it('offers a namespace only when it has a mixin that would be offered after its qualifier', () => {
    const source = (block: readonly string[]) =>
      [
        'namespace models {',
        '  model mixin Stamps {',
        '  }',
        '}',
        'namespace enums {',
        '  enum mixin Roles {',
        '  }',
        '}',
        'namespace empty {',
        '  model Plain {',
        '    id Int',
        '  }',
        '}',
        ...block,
      ].join('\n');
    const labels = (block: readonly string[]) =>
      completeWithSource({ markedSource: source(block), pslBlockDescriptors })
        .items.map(({ label, detail }) => [label, detail])
        .sort();

    expect(labels(['model Invoice {', '  +|', '}'])).toEqual([['models', 'Namespace']]);
    expect(labels(['enum Role {', '  +|', '}'])).toEqual([['enums', 'Namespace']]);
    expect(labels(['model Invoice {', '  +models.Stamps', '  +|', '}'])).toEqual([]);
    expect(labels(['policy P {', '  +|', '}'])).toEqual([]);
  });

  it('does not offer a top-level mixin whose name a model of the namespace hides', () => {
    const { items } = completeWithSource({
      markedSource: [
        'model mixin Timestamps {',
        '  createdAt DateTime',
        '}',
        'namespace app {',
        '  model Timestamps {',
        '    id Int',
        '  }',
        '  model User {',
        '    id Int',
        '    +|',
        '  }',
        '}',
      ].join('\n'),
      pslBlockDescriptors,
    });

    expect(items.map(({ label, detail }) => [label, detail])).toEqual([['public', 'Namespace']]);
  });

  it('offers nothing after a qualifier that names no namespace', () => {
    expect(offered(['model Invoice {', '  +nowhere.|', '}'])).toEqual([]);
    expect(offered(['model Invoice {', '  +Invoice.|', '}'])).toEqual([]);
  });

  it('leaves out a mixin the block already includes, by either spelling', () => {
    expect(
      offered(['model Invoice {', '  +Used', '  +billing.BillingStamps', '  +|', '}']),
    ).toEqual([
      ['TopStamps', 'model mixin'],
      ['auth', 'Namespace'],
      ['public', 'Namespace'],
    ]);
    expect(offered(['model Invoice {', '  +Used', '  +billing.|', '}'])).toEqual([
      ['BillingStamps', 'model mixin'],
    ]);
  });

  it('still offers the mixin whose complete name the cursor is at the end of', () => {
    expect(offered(['model Invoice {', '  +Used|', '}'])).toContainEqual(['Used', 'model mixin']);
  });

  it('offers nothing after a plus inside a mixin body', () => {
    expect(offered(['model mixin Audited {', '  +|', '}'])).toEqual([]);
    expect(offered(['policy mixin Shared {', '  +auth.|', '}'])).toEqual([]);
  });

  it('offers no entry keys after a plus in a struct block', () => {
    const labels = after(['policy P {', '  +|', '}']).items.map((item) => item.label);
    const keys = after(['policy P {', '  |', '}']).items.map((item) => item.label);

    expect(keys.length).toBeGreaterThan(0);
    expect(labels.filter((label) => keys.includes(label))).toEqual([]);
  });

  it('offers no mixins on the line after a plus', () => {
    expect(offered(['model Invoice {', '  +', '  |', '}'])).toEqual([]);
  });

  it('replaces the typed name with the mixin name, and a namespace with its name and a dot', () => {
    const { items, sourceFile, cursorOffset } = after(['model Invoice {', '  +Bil|', '}']);
    const range = {
      start: sourceFile.positionAt(cursorOffset - 3),
      end: sourceFile.positionAt(cursorOffset),
    };

    expect(completionItemByLabel(items, 'BillingStamps')).toMatchObject({
      kind: CompletionItemKind.Interface,
      detail: 'model mixin',
      filterText: 'BillingStamps',
      textEdit: { range, newText: 'BillingStamps' },
    });
    expect(completionItemByLabel(items, 'auth')).toMatchObject({
      kind: CompletionItemKind.Module,
      detail: 'Namespace',
      textEdit: { range, newText: 'auth.' },
    });
  });
});
