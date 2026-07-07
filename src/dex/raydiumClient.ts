import { Api, PoolFetchType, type ApiV3PoolInfoItem } from "@raydium-io/raydium-sdk-v2";
import type { DexClient, DexQuote, Token } from "../types.js";
import { logger } from "../logger.js";

/**
 * Raydium quotes are sourced from Raydium's public pools API (wrapped by
 * the official SDK's `Api` class - a plain HTTP client, no RPC connection
 * needed). Output amount is approximated with the constant-product AMM
 * formula against the pool's reported reserves and fee rate. For
 * concentrated-liquidity (CLMM) pools this is an approximation, not exact
 * tick math - good enough to flag a spread for simulation, but it should
 * not be trusted for sizing a real trade.
 */
export class RaydiumClient implements DexClient {
  readonly name = "Raydium";
  private readonly api: Api;

  constructor() {
    this.api = new Api({ cluster: "mainnet", timeout: 20_000 });
  }

  async getQuote(tokenIn: Token, tokenOut: Token, amountInUi: number): Promise<DexQuote | null> {
    let pools: ApiV3PoolInfoItem[];
    try {
      const res = await this.api.fetchPoolByMints({
        mint1: tokenIn.mint,
        mint2: tokenOut.mint,
        type: PoolFetchType.All,
        sort: "liquidity",
        order: "desc",
        pageSize: 5,
      });
      pools = res.data;
    } catch (err) {
      logger.warn(`Raydium: failed to fetch pools for ${tokenIn.symbol}/${tokenOut.symbol}: ${(err as Error).message}`);
      return null;
    }

    const pool = pools[0];
    if (!pool) return null;

    const inIsMintA = pool.mintA.address === tokenIn.mint;
    const reserveIn = inIsMintA ? pool.mintAmountA : pool.mintAmountB;
    const reserveOut = inIsMintA ? pool.mintAmountB : pool.mintAmountA;
    if (!reserveIn || !reserveOut || reserveIn <= 0 || reserveOut <= 0) return null;

    const feeRate = pool.feeRate ?? 0.0025;
    const amountInAfterFee = amountInUi * (1 - feeRate);
    const amountOutUi = (amountInAfterFee * reserveOut) / (reserveIn + amountInAfterFee);

    if (!Number.isFinite(amountOutUi) || amountOutUi <= 0) return null;

    return { dex: this.name, amountOutUi, poolId: pool.id };
  }
}
