import type { AuthoringTypeConstructorDescriptor } from '@internal/framework-components/authoring';
import type { PslSpan } from '@internal/framework-components/psl-ast';
import type { DiagnosticSource, PslDiagnosticCollector } from './diagnostic';

export function isBareTypeConstructor(descriptor: AuthoringTypeConstructorDescriptor): boolean {
  return (
    descriptor.entityRefArg === undefined &&
    (descriptor.args ?? []).every((arg) => arg.optional === true)
  );
}

function argumentSpelling(descriptor: AuthoringTypeConstructorDescriptor): string {
  const args = descriptor.args ?? [];
  const reference = descriptor.entityRefArg;
  const count = Math.max(args.length, (reference?.index ?? -1) + 1);
  const names: string[] = [];
  for (let index = 0; index < count; index++) {
    const arg = args[index];
    if (index === reference?.index) names.push(reference.entityKind);
    else if (arg !== undefined && arg.optional !== true)
      names.push(arg.name ?? `argument${index + 1}`);
  }
  return names.join(', ');
}

export function reportTypeConstructorNotCalled(input: {
  readonly entityLabel: string;
  readonly path: string;
  readonly descriptor: AuthoringTypeConstructorDescriptor;
  readonly source: DiagnosticSource;
  readonly span: PslSpan;
  readonly diagnostics: PslDiagnosticCollector;
}): void {
  input.diagnostics.push({
    code: 'PSL_TYPE_CONSTRUCTOR_NOT_CALLED',
    message: `${input.entityLabel} uses type constructor "${input.path}" without arguments. Write ${input.path}(${argumentSpelling(input.descriptor)}).`,
    ...input.source.at(input.span),
  });
}
