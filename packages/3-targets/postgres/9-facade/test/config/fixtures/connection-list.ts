// A capabilities list that turns a row flag off, adds connection flags and overrides one of them, which every authoring route must resolve the same way.
export const connectionList = [
  { sql: { returning: false, interactiveTransactions: true, pipelining: true } },
  { sql: { pipelining: false }, http: { batch: true } },
] as const;
