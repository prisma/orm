import type {
  PslAttribute,
  PslCompositeType,
  PslModel,
  PslNamespace,
  PslSpan,
} from '@internal/framework-components/psl-ast';
import { makePslNamespace, makePslNamespaceEntries } from '@internal/framework-components/psl-ast';

export function span(off: number): PslSpan {
  return {
    start: { offset: off, line: 1, column: off + 1 },
    end: { offset: off + 1, line: 1, column: off + 2 },
  };
}

export function attr(
  target: PslAttribute['target'],
  name: string,
  args: PslAttribute['args'],
  off: number,
): PslAttribute {
  return { kind: 'attribute', target, name, args, span: span(off) };
}

export function makeNs(
  name: string,
  models: PslModel[],
  compositeTypes: PslCompositeType[],
  off: number,
): PslNamespace {
  return makePslNamespace({
    kind: 'namespace',
    name,
    entries: makePslNamespaceEntries(models, compositeTypes, []),
    span: span(off),
  });
}
