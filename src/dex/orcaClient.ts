import { Connection, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { ReadOnlyWallet, Percentage } from "@orca-so/common-sdk";
import {
  WhirlpoolContext,
  buildWhirlpoolClient,
  buildDefaultAccountFetcher,
  PDAUtil,
  PoolUtil,
  swapQuoteByInputToken,
  ORCA_WHIRLPOOL_PROGRAM_ID,
  ORCA_WHIRLPOOLS_CONFIG,
  ORCA_SUPPORTED_TICK_SPACINGS,
  type Whirlpool,
} from "@orca-so/whirlpools-sdk";
import type { DexClient, DexQuote, Token } from "../types.js";
import { logger } from "../logger.js";

/**
 * Orca quotes are read directly on-chain via the official Whirlpool SDK
 * (concentrated liquidity / CLMM math via `swapQuoteByInputToken`), since
 * unlike Raydium, Orca's legacy SDK has no connection-free REST client.
 * This only covers standard (non-adaptive-fee) whirlpools, which is where
 * the vast majority of liquidity for common pairs lives.
 */
export class OrcaClient implements DexClient {
  readonly name = "Orca";
  private readonly ctx: WhirlpoolContext;
  private readonly client: ReturnType<typeof buildWhirlpoolClient>;
  private readonly poolCache = new Map<string, PublicKey | null>();

  constructor(rpcUrl: string) {
    const connection = new Connection(rpcUrl, "confirmed");
    const fetcher = buildDefaultAccountFetcher(connection);
    this.ctx = WhirlpoolContext.from(connection, new ReadOnlyWallet(), fetcher);
    this.client = buildWhirlpoolClient(this.ctx);
  }

  private async findPool(mintA: string, mintB: string): Promise<PublicKey | null> {
    const cacheKey = [mintA, mintB].sort().join(":");
    if (this.poolCache.has(cacheKey)) return this.poolCache.get(cacheKey) ?? null;

    const [orderedA, orderedB] = PoolUtil.orderMints(new PublicKey(mintA), new PublicKey(mintB)) as [
      PublicKey,
      PublicKey,
    ];

    let best: { address: PublicKey; liquidity: BN; pool: Whirlpool } | null = null;
    for (const tickSpacing of ORCA_SUPPORTED_TICK_SPACINGS) {
      const pda = PDAUtil.getWhirlpool(ORCA_WHIRLPOOL_PROGRAM_ID, ORCA_WHIRLPOOLS_CONFIG, orderedA, orderedB, tickSpacing);
      try {
        const pool = await this.client.getPool(pda.publicKey);
        const liquidity = pool.getData().liquidity;
        if (liquidity.gtn(0) && (!best || liquidity.gt(best.liquidity))) {
          best = { address: pda.publicKey, liquidity, pool };
        }
      } catch {
        // No whirlpool initialized at this tick spacing for this pair - expected for most.
      }
    }

    this.poolCache.set(cacheKey, best?.address ?? null);
    return best?.address ?? null;
  }

  async getQuote(tokenIn: Token, tokenOut: Token, amountInUi: number): Promise<DexQuote | null> {
    try {
      const poolAddress = await this.findPool(tokenIn.mint, tokenOut.mint);
      if (!poolAddress) return null;

      const pool = await this.client.getPool(poolAddress);
      const amountInRaw = new BN(Math.round(amountInUi * 10 ** tokenIn.decimals).toString());

      const quote = await swapQuoteByInputToken(
        pool,
        new PublicKey(tokenIn.mint),
        amountInRaw,
        Percentage.fromFraction(0, 1000),
        ORCA_WHIRLPOOL_PROGRAM_ID,
        this.ctx.fetcher,
      );

      const amountOutUi = Number(quote.estimatedAmountOut.toString()) / 10 ** tokenOut.decimals;
      if (!Number.isFinite(amountOutUi) || amountOutUi <= 0) return null;

      return { dex: this.name, amountOutUi, poolId: poolAddress.toBase58() };
    } catch (err) {
      logger.warn(`Orca: failed to quote ${tokenIn.symbol}->${tokenOut.symbol}: ${(err as Error).message}`);
      return null;
    }
  }
}
