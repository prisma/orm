declare module '@internal/framework-components/runtime' {
  interface ClientActivityRegistry {
    'test-call': { result: ReadonlyArray<{ readonly id: number }> };
  }
}

export const testCall = { kind: 'test-call', contentHash: async () => 'call-hash' } as const;
