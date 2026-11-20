/**
 * Parses an integer string into a number.
 *
 * @param value - The integer string to parse.
 * @returns The parsed number.
 * @throws {Error} If the integer string is invalid.
 */
export function parseInteger(value: string): number {
  const number = Number.parseInt(value, 10)

  if (isNaN(number)) {
    throw new Error(`Invalid integer: ${value}`)
  }

  // Ensure we don't have trailing characters that were ignored by `parseInt`.
  if (number.toString() !== value) {
    throw new Error(`Invalid integer: ${value}`)
  }

  return number
}
