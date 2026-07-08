import { Connection } from "@solana/web3.js";
import { Client, getQuoteUnitsOutFromRawBaseUnitsIn, getRawBaseUnitsOutFromQuoteUnitsIn } from "@ellipsis-labs/phoenix-sdk";
import type { DexClient, DexQuote, Token } from "../types.js";
import { logger } from "../logger.js";

interface MarketMatch {
  marketAddress: string;
  baseMint: string;
}

/**
 * Phoenix is a central-limit-order-book DEX, not an AMM, so quotes come
 * from walking the live order book (`getUiLadder`) rather than reserve
 * math. Only covers the curated set of markets the official SDK loads via
 * `Client.create` - Phoenix has far fewer markets than Raydium/Orca/Meteora,
 * so this will simply return null (no opportunity contribution) for pairs
 * it doesn't list.
 */
export class PhoenixClient implements DexClient {
  readonly name = "Phoenix";
  private readonly connection: Connection;
  private clientPromise: Promise<Client> | null = null;
  private readonly marketCache = new Map<string, MarketMatch | null>();

  constructor(rpcUrl: string) {
    this.connection = new Connection(rpcUrl, "confirmed");
  }

  private getClient(): Promise<Client> {
    if (!this.clientPromise) this.clientPromise = Client.create(this.connection);
    return this.clientPromise;
  }

  private findMarket(client: Client, mintA: string, mintB: string): MarketMatch | null {
    const cacheKey = [mintA, mintB].sort().join(":");
    if (this.marketCache.has(cacheKey)) return this.marketCache.get(cacheKey) ?? null;

    let result: MarketMatch | null = null;
    for (const [marketAddress, marketConfig] of client.marketConfigs) {
      const base = marketConfig.baseToken.mint;
      const quote = marketConfig.quoteToken.mint;
      if ((base === mintA && quote === mintB) || (base === mintB && quote === mintA)) {
        result = { marketAddress, baseMint: base };
        break;
      }
    }
    this.marketCache.set(cacheKey, result);
    return result;
  }

  async getQuote(tokenIn: Token, tokenOut: Token, amountInUi: number): Promise<DexQuote | null> {
    try {
      const client = await this.getClient();
      const market = this.findMarket(client, tokenIn.mint, tokenOut.mint);
      if (!market) return null;

      await client.refreshMarket(market.marketAddress);
      const marketState = client.marketStates.get(market.marketAddress);
      if (!marketState) return null;

      const uiLadder = client.getUiLadder(market.marketAddress);
      const takerFeeBps = marketState.data.takerFeeBps;

      const amountOutUi =
        tokenIn.mint === market.baseMint
          ? getQuoteUnitsOutFromRawBaseUnitsIn({ uiLadder, takerFeeBps, rawBaseUnitsIn: amountInUi })
          : getRawBaseUnitsOutFromQuoteUnitsIn({ uiLadder, takerFeeBps, quoteUnitsIn: amountInUi });

      if (!Number.isFinite(amountOutUi) || amountOutUi <= 0) return null;
      return { dex: this.name, amountOutUi, poolId: market.marketAddress };
    } catch (err) {
      logger.warn(`Phoenix: failed to quote ${tokenIn.symbol}->${tokenOut.symbol}: ${(err as Error).message}`);
      return null;
    }
  }
}
