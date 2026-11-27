export declare const a: string;
export type OnlyStrings<T> = T extends string ? { value: T } : never;
