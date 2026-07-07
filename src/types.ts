export interface Token {
  symbol: string;
  mint: string;
  decimals: number;
}

export interface ArbitragePair {
  name: string;
  base: Token;
  quote: Token;
  /** Amount of `base` tokens used for each simulated round trip. */
  tradeSizeUi: number;
}

export interface DexQuote {
  dex: string;
  amountOutUi: number;
  poolId?: string;
}

export interface DexClient {
  name: string;
  /** Returns the estimated output amount for swapping `amountInUi` of tokenIn into tokenOut, or null if no route/pool was found. */
  getQuote(tokenIn: Token, tokenOut: Token, amountInUi: number): Promise<DexQuote | null>;
}

export interface ArbitrageOpportunity {
  pair: string;
  buyDex: string;
  sellDex: string;
  amountInUi: number;
  amountOutUi: number;
  grossProfitUi: number;
  grossProfitBps: number;
  netProfitBps: number;
  timestamp: string;
}
