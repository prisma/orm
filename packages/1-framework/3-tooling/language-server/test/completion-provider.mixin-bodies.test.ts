import { describe, expect, it } from 'vitest';
import type { CompletionItem } from 'vscode-languageserver';
import { complete } from './helpers/completion-provider';

describe('providePslCompletionItems — inside a mixin body', () => {
  const declarationKeywords = ['namespace', 'types'];

  const withoutOwnName = (items: readonly CompletionItem[]) =>
    items.filter((item) => item.label !== 'Probe');

  function itemsIn(header: string, body: readonly string[], closed = true) {
    return complete([header, ...body, ...(closed ? ['}'] : [])].join('\n')).items;
  }

  it.each([
    ['a field type', ['  scopedOnly Int', '  value |']],
    ['a field attribute name', ['  scopedOnly Int', '  value Int @|']],
    ['a field attribute argument', ['  value Int @marker(|)']],
    [
      'a field attribute key that depends on the fields of the owner',
      ['  scopedOnly Int', '  value Int @ownerAware(|)'],
    ],
    ['a field attribute key when the owner lacks the field', ['  value Int @ownerAware(|)']],
    ['a block attribute name', ['  value Int', '  @@|']],
    ['a block attribute argument', ['  value Int', '  @@security.rls(|)']],
  ])('offers in a model mixin what a model offers at %s', (_position, body) => {
    const inMixin = itemsIn('model mixin Probe {', body);

    expect(inMixin).toEqual(withoutOwnName(itemsIn('model Probe {', body)));
    expect(
      inMixin.map((item) => item.label).filter((label) => declarationKeywords.includes(label)),
    ).toEqual([]);
  });

  it('offers something at each model position the fixture has candidates for', () => {
    expect(itemsIn('model mixin Probe {', ['  value |']).length).toBeGreaterThan(0);
    expect(itemsIn('model mixin Probe {', ['  value Int @|']).length).toBeGreaterThan(0);
    expect(itemsIn('model mixin Probe {', ['  value Int', '  @@|']).length).toBeGreaterThan(0);
    expect(
      itemsIn('model mixin Probe {', ['  scopedOnly Int', '  value Int @ownerAware(|)']).map(
        (item) => item.label,
      ),
    ).toEqual(['scopedKey']);
  });

  it.each([
    ['a field type', ['  value |']],
    ['a field attribute name', ['  value Int @|']],
    ['a field attribute argument', ['  value Int @marker(|)']],
    ['a block attribute name', ['  value Int', '  @@|']],
  ])('offers in a type mixin what a composite type offers at %s', (_position, body) => {
    const inMixin = itemsIn('type mixin Probe {', body);

    expect(inMixin).toEqual(withoutOwnName(itemsIn('type Probe {', body)));
    expect(
      inMixin.map((item) => item.label).filter((label) => declarationKeywords.includes(label)),
    ).toEqual([]);
  });

  it.each([
    ['an entry key', 'policy', ['  |']],
    ['an entry key after another entry', 'policy', ['  on = User', '  |']],
    ['an entry value that names a model', 'policy', ['  on = |']],
    ['an entry value with fixed identifiers', 'policy', ['  mode = |']],
    ['a block attribute name', 'policy', ['  @@|']],
    ['a block attribute argument', 'policy', ['  @@audit(|)']],
    ['an entry key of a map block', 'inventory', ['  |']],
    ['an entry value of a map block', 'inventory', ['  count = |']],
  ])(
    'offers in a mixin for a key = value keyword what a block of that keyword offers at %s',
    (_position, keyword, body) => {
      const inMixin = itemsIn(`${keyword} mixin Probe {`, body);

      expect(inMixin).toEqual(itemsIn(`${keyword} Probe {`, body));
      expect(
        inMixin.map((item) => item.label).filter((label) => declarationKeywords.includes(label)),
      ).toEqual([]);
    },
  );

  it('offers something at each struct block position', () => {
    expect(itemsIn('policy mixin Probe {', ['  |']).map((item) => item.label)).toContain('on');
    expect(itemsIn('policy mixin Probe {', ['  mode = |']).map((item) => item.label)).toEqual([
      'permissive',
      'restrictive',
    ]);
    expect(itemsIn('policy mixin Probe {', ['  @@|']).map((item) => item.label)).toEqual(['audit']);
  });

  it('offers nothing and does not fail in a mixin for a keyword with no registered block', () => {
    expect(itemsIn('widget mixin Probe {', ['  |'])).toEqual(itemsIn('widget Probe {', ['  |']));
    expect(itemsIn('widget mixin Probe {', ['  |'])).toEqual([]);
    expect(itemsIn('widget mixin Probe {', ['  @@|'])).toEqual([]);
    expect(itemsIn('widget mixin Probe {', ['  key = |'])).toEqual([]);
  });

  it('completes inside a mixin that is not closed yet as inside a model that is not closed yet', () => {
    const body = ['  scopedOnly Int', '  value Int @|'];

    expect(itemsIn('model mixin Probe {', body, false)).toEqual(
      itemsIn('model Probe {', body, false),
    );
    expect(itemsIn('model mixin Probe {', body, false).length).toBeGreaterThan(0);
    expect(itemsIn('policy mixin Probe {', ['  |'], false)).toEqual(
      itemsIn('policy Probe {', ['  |'], false),
    );
  });

  it('offers the same inside a mixin declared in a namespace', () => {
    const inNamespace = (header: string) =>
      complete(['namespace scoped {', `  ${header}`, '    value |', '  }', '}'].join('\n')).items;

    expect(inNamespace('model mixin Probe {')).toEqual(
      withoutOwnName(inNamespace('model Probe {')),
    );
  });
});

describe('providePslCompletionItems — keys a block already has', () => {
  const keysOf = (block: readonly string[]) =>
    complete(['policy mixin Shared {', '  on = User', '  where = "true"', '}', ...block].join('\n'))
      .items.map((item) => item.label)
      .sort();

  it('does not offer a key that an included mixin provides', () => {
    expect(keysOf(['policy P {', '  +Shared', '  |', '}'])).toEqual(['mode', 'using']);
  });

  it('offers that key in the same block without the inclusion', () => {
    expect(keysOf(['policy P {', '  |', '}'])).toEqual(['mode', 'on', 'using', 'where']);
  });

  it('does not offer a key written in the block itself, and still offers the key under the cursor', () => {
    expect(keysOf(['policy P {', '  mode = permissive', '  |', '}'])).toEqual([
      'on',
      'using',
      'where',
    ]);
    expect(keysOf(['policy P {', '  +Shared', '  mo|', '}'])).toEqual(['mode', 'using']);
  });
});
