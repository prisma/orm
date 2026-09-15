import type { Param, PositionalParam } from '@internal/psl-parser';

interface ArgumentSignature {
  readonly positional?: readonly PositionalParam<unknown, never>[];
  readonly named?: Readonly<Record<string, Param<unknown, never>>>;
}

type RequiredArgument =
  | { readonly kind: 'positional'; readonly argument: PositionalParam<unknown, never> }
  | { readonly kind: 'named'; readonly key: string; readonly type: Param<unknown, never> };

export function requiredArgumentsSnippet(signature: ArgumentSignature): string {
  return requiredArguments(signature)
    .map((argument, index) => requiredArgumentSnippet(argument, index + 1))
    .join(', ');
}

function requiredArguments(signature: ArgumentSignature): readonly RequiredArgument[] {
  const positional = signature.positional ?? [];
  const positionalKeys = new Set(positional.map((argument) => argument.key));
  return [
    ...positional.flatMap((argument) =>
      isOptionalParam(argument.type)
        ? []
        : [{ kind: 'positional', argument } satisfies RequiredArgument],
    ),
    ...Object.entries(signature.named ?? {}).flatMap(([key, type]) =>
      positionalKeys.has(key) || isOptionalParam(type)
        ? []
        : [{ kind: 'named', key, type } satisfies RequiredArgument],
    ),
  ];
}

function requiredArgumentSnippet(argument: RequiredArgument, tabStop: number): string {
  if (argument.kind === 'positional') {
    return argSnippetPlaceholder(argument.argument.type, tabStop);
  }
  return `${argument.key}: ${argSnippetPlaceholder(argument.type, tabStop)}`;
}

function argSnippetPlaceholder(param: Param<unknown, never>, tabStop: number): string {
  const placeholder = `\${${tabStop.toString()}:}`;
  if (param.kind === 'str') return `"${placeholder}"`;
  if (param.kind === 'list') return `[${placeholder}]`;
  if (param.kind === 'record') return `{ ${placeholder} }`;
  return placeholder;
}

function isOptionalParam(param: Param<unknown, never>): boolean {
  return 'optional' in param && param.optional === true;
}
