/** What the connection this driver opens provides: a connection held for a transaction whose statements the application sends one at a time. */
export const postgresDriverCapabilities = Object.freeze({
  sql: Object.freeze({ interactiveTransactions: true }),
} as const);
