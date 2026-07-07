import type { ArbitragePair, ArbitrageOpportunity, DexClient, DexQuote } from "../types.js";
import { logger } from "../logger.js";

export interface ScanResult {
  pair: string;
  opportunities: ArbitrageOpportunity[];
  bestNetBps: number | null;
}

/**
 * For a pair, quotes base->quote on every DEX, then for every (buyDex,
 * sellDex) combination quotes the resulting quote-token amount back into
 * base on the other DEX. A round trip is an "opportunity" once its net
 * spread (gross spread minus the assumed cost buffer) clears the
 * configured minimum.
 */
export async function scanPair(
  pair: ArbitragePair,
  dexClients: DexClient[],
  minProfitBps: number,
  assumedCostBufferBps: number,
): Promise<ScanResult> {
  const forwardQuotes = await Promise.all(
    dexClients.map(async (client) => ({ client, quote: await client.getQuote(pair.base, pair.quote, pair.tradeSizeUi) })),
  );

  const opportunities: ArbitrageOpportunity[] = [];
  let bestNetBps: number | null = null;

  for (const { client: buyClient, quote: buyQuote } of forwardQuotes) {
    if (!buyQuote) continue;

    for (const sellClient of dexClients) {
      if (sellClient.name === buyClient.name) continue;

      let sellQuote: DexQuote | null;
      try {
        sellQuote = await sellClient.getQuote(pair.quote, pair.base, buyQuote.amountOutUi);
      } catch (err) {
        logger.warn(`${pair.name}: ${sellClient.name} reverse quote failed: ${(err as Error).message}`);
        continue;
      }
      if (!sellQuote) continue;

      const grossProfitUi = sellQuote.amountOutUi - pair.tradeSizeUi;
      const grossProfitBps = (grossProfitUi / pair.tradeSizeUi) * 10_000;
      const netProfitBps = grossProfitBps - assumedCostBufferBps;

      if (bestNetBps === null || netProfitBps > bestNetBps) bestNetBps = netProfitBps;

      if (netProfitBps >= minProfitBps) {
        opportunities.push({
          pair: pair.name,
          buyDex: buyClient.name,
          sellDex: sellClient.name,
          amountInUi: pair.tradeSizeUi,
          amountOutUi: sellQuote.amountOutUi,
          grossProfitUi,
          grossProfitBps,
          netProfitBps,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  return { pair: pair.name, opportunities, bestNetBps };
}
