import type { ArgType, InspectableArgType, Param, PositionalParam } from '@internal/psl-parser';
import { blindCast } from '@internal/utils/casts';
import type { AttributeArgumentPathStep } from './attribute-syntax-context';

export interface ArgumentSignature {
  readonly documentation: string;
  readonly positional?: readonly PositionalParam<unknown, never>[];
  readonly named?: Readonly<Record<string, Param<unknown, never>>>;
}

type Grammar = ArgumentSignature | ArgType<unknown, never>;

export function directArgType(param: ArgType<unknown, never>): InspectableArgType<never> {
  return blindCast<
    InspectableArgType<never>,
    'Editor features inspect registry combinators whose constructors retain kind-specific metadata; public ArgType erases that metadata, and inspection never invokes parse.'
  >(param);
}

export function resolveGrammar(
  signature: ArgumentSignature,
  path: readonly AttributeArgumentPathStep[],
): readonly Grammar[] {
  let grammars: readonly Grammar[] = [signature];
  for (const step of path) {
    grammars = grammars.flatMap((grammar) => advanceGrammar(grammar, step));
  }
  return grammars;
}

function advanceGrammar(grammar: Grammar, step: AttributeArgumentPathStep): readonly Grammar[] {
  const type = 'kind' in grammar ? directArgType(grammar) : undefined;
  if (type?.kind === 'oneOf') {
    return type.alternatives.flatMap((alternative) => advanceGrammar(alternative, step));
  }
  switch (step.kind) {
    case 'positionalArgument': {
      if ('kind' in grammar) return [];
      const param = grammar.positional?.[step.index]?.type;
      return param === undefined ? [] : [param];
    }
    case 'namedArgument': {
      if ('kind' in grammar) return [];
      const param = grammar.named?.[step.name]?.type;
      return param === undefined ? [] : [param];
    }
    case 'listElement':
      return type?.kind === 'list' ? [type.of] : [];
    case 'recordValue':
      return type?.kind === 'record' ? [type.of] : [];
    case 'functionCall':
      return type?.kind === 'funcCall' && type.name === step.name ? [type.signature] : [];
  }
}
