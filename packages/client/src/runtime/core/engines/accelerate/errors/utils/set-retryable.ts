export function setRetryable<T>(info: T, retryable: boolean) {
  return {
    ...info,
    isRetryable: retryable,
  }
}
