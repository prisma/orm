import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { type AnyEntityKindDescriptor, hydrateNamespaceEntities } from '../src/ir/entity-kind';

const widgetSchema = type({ name: 'string', 'value?': 'number' });
type WidgetInput = typeof widgetSchema.infer;

class Widget {
  readonly name: string;
  readonly value: number | undefined;
  constructor(input: WidgetInput) {
    this.name = input.name;
    this.value = input.value;
  }
}

const widgetKind: AnyEntityKindDescriptor = {
  kind: 'widget',
  schema: widgetSchema as never,
  construct: (input: never) => new Widget(input as WidgetInput),
};

const gadgetSchema = type({ id: 'string' });
type GadgetInput = typeof gadgetSchema.infer;

class Gadget {
  readonly id: string;
  constructor(input: GadgetInput) {
    this.id = input.id;
  }
}

const gadgetKind: AnyEntityKindDescriptor = {
  kind: 'gadget',
  schema: gadgetSchema as never,
  construct: (input: never) => new Gadget(input as GadgetInput),
};

const kinds = new Map<string, AnyEntityKindDescriptor>([
  ['widget', widgetKind],
  ['gadget', gadgetKind],
]);

describe('hydrateNamespaceEntities', () => {
  it('constructs known kinds', () => {
    const result = hydrateNamespaceEntities(
      { widget: { foo: { name: 'foo', value: 1 } } },
      kinds,
      'carry',
    );
    expect(result['widget']?.['foo']).toBeInstanceOf(Widget);
  });

  it('carries unknown kinds frozen when onUnknown is carry', () => {
    const raw = Object.freeze({ x: { id: 'x' } });
    const result = hydrateNamespaceEntities(
      { widget: {}, unknown: raw } as Record<string, Record<string, unknown>>,
      kinds,
      'carry',
    );
    expect(result['unknown']).toBe(raw);
    expect(Object.isFrozen(result['unknown'])).toBe(true);
  });

  it('freezes constructed kind maps', () => {
    const result = hydrateNamespaceEntities({ widget: { a: { name: 'a' } } }, kinds, 'carry');
    expect(Object.isFrozen(result['widget'])).toBe(true);
  });

  it('constructs multiple kinds in the same entries map', () => {
    const result = hydrateNamespaceEntities(
      { widget: { w: { name: 'w' } }, gadget: { g: { id: 'g' } } },
      kinds,
      'carry',
    );
    expect(result['widget']?.['w']).toBeInstanceOf(Widget);
    expect(result['gadget']?.['g']).toBeInstanceOf(Gadget);
  });
});
