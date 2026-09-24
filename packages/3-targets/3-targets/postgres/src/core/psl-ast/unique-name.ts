/** `desiredName`, or it with the lowest number from 2 up that makes it unused. */
export function createUniqueFieldName(
  desiredName: string,
  usedFieldNames: ReadonlySet<string>,
): string {
  if (!usedFieldNames.has(desiredName)) {
    return desiredName;
  }

  let counter = 2;
  while (usedFieldNames.has(`${desiredName}${counter}`)) {
    counter++;
  }
  return `${desiredName}${counter}`;
}
