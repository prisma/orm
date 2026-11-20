/**
 * Returns an {@link Error} if the value is an instance of Error, otherwise
 * returns a string representation of the value.
 */
export function extractErrorFromUnknown(value: unknown): Error | string {
  if (value instanceof Error) {
    return value
  }
  return String(value)
}
