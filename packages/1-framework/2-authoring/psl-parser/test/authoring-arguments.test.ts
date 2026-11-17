import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import type { AuthoringTypeChoiceOption } from '@internal/framework-components/authoring';
import type { PslSpan } from '@internal/framework-components/psl-ast';
import { describe, expect, it } from 'vitest';
import { EMPTY_DATA_TYPES } from '../src/attribute-spec/spec-context';
import { mapPslHelperArgs } from '../src/authoring-arguments';
import { createPslDiagnosticCollector, diagnosticSource } from '../src/diagnostic';
import { parse } from '../src/parse';
import type { ResolvedAttributeArg } from '../src/resolve';

const SPAN: PslSpan = {
  start: { offset: 0, line: 1, column: 1 },
  end: { offset: 0, line: 1, column: 1 },
};

const AS: AuthoringTypeChoiceOption = {
  kind: 'option',
  name: 'as',
  values: ['string', 'temporal'],
  default: 'string',
  optional: true,
};

function positional(value: string): ResolvedAttributeArg {
  return { kind: 'positional', value, span: SPAN };
}

function callMap(args: readonly ResolvedAttributeArg[]): {
  result: readonly unknown[] | undefined;
  diagnostics: ContractSourceDiagnostic[];
} {
  const { document, sources } = parse('', 'schema.prisma');
  const diagnostics = createPslDiagnosticCollector(sources);
  const result = mapPslHelperArgs({
    args,
    descriptors: [AS],
    helperLabel: 'type "DateTime"',
    span: SPAN,
    diagnostics,
    source: diagnosticSource(sources, document.syntax),
    entityLabel: 'Field "Model.field"',
    dataTypes: EMPTY_DATA_TYPES,
  });
  return { result, diagnostics: diagnostics.toExternal() };
}

describe('mapPslHelperArgs on a type choice option', () => {
  it('reads a bare name', () => {
    expect(callMap([positional('temporal')])).toEqual({ result: ['temporal'], diagnostics: [] });
  });

  it.each(['"string"', '1', '{a: 1}'])('names the values the option takes for %s', (written) => {
    const { result, diagnostics } = callMap([positional(written)]);
    expect(result).toBeUndefined();
    expect(diagnostics[0]?.message).toMatch(
      new RegExp(
        ` argument #1 is ${written.replace(/[{}]/g, '\\$&')}, but argument "as" takes one of these names, written without quotes: string, temporal\\.$`,
      ),
    );
  });
});
