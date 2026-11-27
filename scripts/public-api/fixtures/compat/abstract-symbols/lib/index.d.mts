declare const kRun: unique symbol;
export declare abstract class WellKnown {
  abstract [Symbol.iterator](): Iterator<string>;
}
export declare abstract class OwnSymbol {
  abstract [kRun](): void;
}
