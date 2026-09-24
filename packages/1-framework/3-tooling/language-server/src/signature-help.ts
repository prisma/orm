import type { AttributeSpec, PositionalParam } from '@internal/psl-parser';
import {
  MarkupKind,
  type ParameterInformation,
  type SignatureHelp,
  type SignatureInformation,
} from 'vscode-languageserver';
import { type ArgumentSignature, resolveGrammar } from './attribute-argument-grammar';
import { type AttributeSpecSource, attributeSpecResolver } from './attribute-spec-resolution';
import type { AttributeArgumentPathStep, PslCursorInput } from './attribute-syntax-context';
import { type AttributeSignatureContext, classifyPslSignatureContext } from './signature-context';

export interface ProvidePslSignatureHelpInput extends PslCursorInput {
  readonly candidates: AttributeSpecSource;
  readonly clientSupportsLabelOffsets?: boolean;
}

export function providePslSignatureHelp(input: ProvidePslSignatureHelpInput): SignatureHelp | null {
  const context = classifyPslSignatureContext(input);
  if (context === undefined) return null;
  const spec = attributeSpecResolver(context, input.candidates)(context.attributeName);
  if (spec === undefined) return null;
  return signatureHelp(context, spec, input.clientSupportsLabelOffsets === true);
}

function signatureHelp(
  context: AttributeSignatureContext,
  spec: AttributeSpec<never, never>,
  labelOffsets: boolean,
): SignatureHelp | null {
  const callIndex = context.path.reduce(
    (last, step, index) => (step.kind === 'functionCall' ? index : last),
    -1,
  );
  const call = context.path[callIndex];
  const signaturePath = context.path.slice(0, callIndex + 1);
  const name =
    call?.kind === 'functionCall'
      ? call.name
      : `${spec.level === 'field' ? '@' : '@@'}${spec.name}`;
  const signatures = resolveGrammar(spec, signaturePath).flatMap((grammar) => {
    if ('kind' in grammar) return [];
    const active = context.path[callIndex + 1];
    const params = parameters(grammar, active?.kind === 'namedArgument' ? active.name : undefined);
    const index = parameterIndex(context, active, params);
    return [{ signature: renderSignature(name, grammar, params, labelOffsets), index }];
  });
  if (signatures.length === 0) return null;
  const matched = signatures.findIndex(
    ({ signature, index }) => index >= 0 && index < (signature.parameters?.length ?? 0),
  );
  const activeSignature = matched < 0 ? 0 : matched;
  const activeParameter = signatures[activeSignature]?.index;
  return {
    signatures: signatures.map(({ signature }) => signature),
    activeSignature,
    ...(matched >= 0 && activeParameter !== undefined ? { activeParameter } : {}),
  };
}

function parameterIndex(
  context: AttributeSignatureContext,
  active: AttributeArgumentPathStep | undefined,
  params: readonly PositionalParam<unknown, never>[],
): number {
  if (active?.kind === 'namedArgument')
    return params.findIndex((param) => param.key === active.name);
  if (active?.kind === 'positionalArgument') return active.index;
  const slot = context.argumentSlot;
  if (slot !== undefined) {
    return params.findIndex(
      (param, index) =>
        index >= slot.positionalIndex && !slot.existingNamedKeys.includes(param.key),
    );
  }
  return -1;
}

function parameters(signature: ArgumentSignature, activeName: string | undefined) {
  const positional = signature.positional ?? [];
  const keys = new Set(positional.map((param) => param.key));
  const namedAlias = activeName === undefined ? undefined : signature.named?.[activeName];
  return [
    ...positional.map((param) =>
      param.key === activeName && namedAlias !== undefined
        ? { key: param.key, ...namedAlias }
        : param,
    ),
    ...Object.entries(signature.named ?? {}).flatMap(([key, param]) =>
      keys.has(key) ? [] : [{ key, ...param }],
    ),
  ];
}

function renderSignature(
  name: string,
  signature: ArgumentSignature,
  params: readonly PositionalParam<unknown, never>[],
  labelOffsets: boolean,
): SignatureInformation {
  let label = `${name}(`;
  const rendered: ParameterInformation[] = params.map((param, index) => {
    if (index > 0) label += ', ';
    const positional = index < (signature.positional?.length ?? 0);
    const optional = 'optional' in param.type && param.type.optional === true;
    const typeLabel =
      optional && param.type.label.includes(' | ') ? `(${param.type.label})` : param.type.label;
    const text = positional
      ? `${typeLabel}${optional ? '?' : ''}`
      : `${param.key}${optional ? '?' : ''}: ${param.type.label}`;
    const start = label.length;
    label += text;
    const documentation = positional
      ? `**${param.key}**\n\n${param.documentation}${signature.named?.[param.key] === undefined ? '' : `\n\nAccepted positionally or by \`${param.key}:\`.`}`
      : param.documentation;
    return {
      label: positional && labelOffsets ? [start, label.length] : text,
      documentation: {
        kind: MarkupKind.Markdown,
        value: documentation,
      },
    };
  });
  return {
    label: `${label})`,
    documentation: { kind: MarkupKind.Markdown, value: signature.documentation },
    parameters: rendered,
  };
}
