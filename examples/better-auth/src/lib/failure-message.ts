/** What a failed Better Auth client call shows: its message, else the HTTP status text, else a plain sentence. A proxy's non-JSON error page gives no message. */
export function failureMessage(
  error: { readonly message?: string | undefined; readonly statusText?: string | undefined },
  action: string,
): string {
  return error.message || error.statusText || `${action} failed. Try again.`;
}
