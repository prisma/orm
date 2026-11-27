interface Reader {
  get(key: string): string;
  readonly size: number;
  get(key: number): number;
}
export type { Reader };
