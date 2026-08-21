/**
 * Extracts the single-quoted string literals from a live CHECK expression
 * reprint, in order of appearance, with doubled quotes unescaped
 * (`'O''Brien'` → `O'Brien`). A text scan only — no predicate shape is
 * recognized; casts, operators, and identifiers are skipped. An expression
 * with no literals yields an empty list.
 */
export function harvestCheckLiterals(expression: string): string[] {
  const literals: string[] = [];
  let index = 0;
  while (index < expression.length) {
    if (expression[index] !== `'`) {
      index += 1;
      continue;
    }
    index += 1;
    let value = '';
    while (index < expression.length) {
      if (expression[index] !== `'`) {
        value += expression[index];
        index += 1;
        continue;
      }
      if (expression[index + 1] === `'`) {
        value += `'`;
        index += 2;
        continue;
      }
      index += 1;
      literals.push(value);
      break;
    }
  }
  return literals;
}
