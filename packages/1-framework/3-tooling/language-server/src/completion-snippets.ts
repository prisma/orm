import type {
  ArgType,
  ContributedTypeDescriptor,
  Param,
  PositionalParam,
} from '@internal/psl-parser';

interface ArgumentSignature {
  readonly positional?: readonly PositionalParam<unknown, never>[];
  readonly named?: Readonly<Record<string, Param<unknown, never>>>;
}

type RequiredArgument =
  | { readonly kind: 'positional'; readonly argument: PositionalParam<unknown, never> }
  | { readonly kind: 'named'; readonly key: string; readonly type: ArgType<unknown, never> };

export function requiredArgumentsSnippet(signature: ArgumentSignature): string {
  return requiredArguments(signature)
    .map((argument, index) => requiredArgumentSnippet(argument, index + 1))
    .join(', ');
}

export function typeConstructorSnippet(
  name: string,
  descriptor: ContributedTypeDescriptor,
): string {
  const args = descriptor.args ?? [];
  const reference = descriptor.kind === 'typeConstructor' ? descriptor.entityRefArg : undefined;
  const count = Math.max(args.length, (reference?.index ?? -1) + 1);
  const values: string[] = [];
  for (let index = 0; index < count; index++) {
    const arg = args[index];
    if (index === reference?.index) {
      values.push(argSnippetPlaceholder('identifier', values.length + 1, reference.entityKind));
    } else if (arg !== undefined && arg.optional !== true) {
      const key = arg.name ?? `arg${index + 1}`;
      const kind =
        arg.kind === 'string' || arg.kind === 'stringArray'
          ? 'str'
          : arg.kind === 'object'
            ? 'record'
            : 'identifier';
      const placeholder = argSnippetPlaceholder(kind, values.length + 1, key);
      values.push(arg.kind === 'stringArray' ? `[${placeholder}]` : placeholder);
    }
  }
  const content = values.join(', ') || (count > 0 ? '$' + '{1:}' : '');
  return `${name}(${content})`;
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
    ...Object.entries(signature.named ?? {}).flatMap(([key, { type }]) =>
      positionalKeys.has(key) || isOptionalParam(type)
        ? []
        : [{ kind: 'named', key, type } satisfies RequiredArgument],
    ),
  ];
}

function requiredArgumentSnippet(argument: RequiredArgument, tabStop: number): string {
  if (argument.kind === 'positional') {
    return argSnippetPlaceholder(argument.argument.type.kind, tabStop, argument.argument.key);
  }
  return `${argument.key}: ${argSnippetPlaceholder(argument.type.kind, tabStop, argument.key)}`;
}

function argSnippetPlaceholder(
  kind: ArgType<unknown, never>['kind'],
  tabStop: number,
  key: string,
): string {
  const placeholder = `\${${tabStop.toString()}:${key}}`;
  if (kind === 'str') return `"${placeholder}"`;
  if (kind === 'list') return `[${placeholder}]`;
  if (kind === 'record') return `{ ${placeholder} }`;
  return placeholder;
}

function isOptionalParam(param: ArgType<unknown, never>): boolean {
  return 'optional' in param && param.optional === true;
}
