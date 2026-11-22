import { type ContractComparison, idLineOf } from './compare';
import { printPsl } from './print-psl';

function section(title: string, lines: readonly string[]): string[] {
  return lines.length === 0 ? [] : [`${title}:`, '', ...lines.map((line) => `  ${line}`), ''];
}

function changeLines(comparison: ContractComparison): string[] {
  const lines: string[] = [];
  const idLinesPrinted = new Set<string>();
  for (const problem of comparison.problems) {
    switch (problem.kind) {
      case 'ambiguous-model':
        lines.push(problem.message);
        break;
      case 'id-without-default':
      case 'wrong-type':
        if (problem.kind === 'id-without-default' || problem.field === 'id') {
          if (idLinesPrinted.has(problem.model)) break;
          idLinesPrinted.add(problem.model);
          lines.push(`${problem.model}.id: must be \`${idLineOf(comparison.idStrategy)}\``);
          break;
        }
        lines.push(
          `${problem.model}.${problem.field}: must be \`${problem.expectedType}\` (found ${problem.found})`,
        );
        break;
    }
  }
  return lines;
}

function unwrittenLines(comparison: ContractComparison): string[] {
  return comparison.problems.flatMap((problem) =>
    problem.kind === 'required-field-not-written'
      ? [`${problem.model}.${problem.field}: make it optional or give it a default`]
      : [],
  );
}

/**
 * The message the contract check and `auth generate` report, or `undefined` when the contract holds everything Better Auth needs.
 */
export function contractMessage(comparison: ContractComparison): string | undefined {
  if (comparison.problems.length === 0) return undefined;
  const psl = printPsl(comparison);
  const additions = psl.text === '' ? [] : ['Add to your contract:', '', psl.text, ''];
  const heading =
    additions.length > 0
      ? 'Your Prisma contract is missing models or fields that Better Auth needs.'
      : 'Your Prisma contract does not match what Better Auth needs.';
  return [
    heading,
    '',
    ...additions,
    ...section('Change in your contract', changeLines(comparison)),
    ...section('Fields Better Auth does not write', unwrittenLines(comparison)),
    ...section('Notes', psl.notes),
    'Then run `prisma contract emit` and update your database.',
  ].join('\n');
}
