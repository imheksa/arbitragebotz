import { Connection, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
// Named import, not default: this package's CJS build doesn't set the
// __esModule interop marker, so `import AmmImpl from "..."` binds to the
// whole module namespace object instead of the class.
import { AmmImpl } from "@meteora-ag/dynamic-amm-sdk";
import type { DexClient, DexQuote, Token } from "../types.js";
import { logger } from "../logger.js";

/**
 * Meteora Dynamic AMM (classic constant-product / stable-swap pools)
 * quotes, read on-chain via the official SDK's exact curve math
 * (`getSwapQuote`). Pool discovery uses `AmmImpl.searchPoolsByToken`, a
 * mint-filtered on-chain scan (memcmp filter on one mint), much cheaper
 * than an unfiltered program scan.
 */
export class MeteoraDynamicAmmClient implements DexClient {
  readonly name = "Meteora Dynamic AMM";
  private readonly connection: Connection;
  private readonly poolCache = new Map<string, PublicKey | null>();
  private readonly instanceCache = new Map<string, AmmImpl>();

  constructor(rpcUrl: string) {
    this.connection = new Connection(rpcUrl, "confirmed");
  }

  private async findPool(mintA: string, mintB: string): Promise<PublicKey | null> {
    const cacheKey = [mintA, mintB].sort().join(":");
    if (this.poolCache.has(cacheKey)) return this.poolCache.get(cacheKey) ?? null;

    let candidates: Awaited<ReturnType<typeof AmmImpl.searchPoolsByToken>>;
    try {
      candidates = await AmmImpl.searchPoolsByToken(this.connection, new PublicKey(mintA));
    } catch (err) {
      logger.warn(`Meteora Dynamic AMM: pool search failed for mint ${mintA}: ${(err as Error).message}`);
      this.poolCache.set(cacheKey, null);
      return null;
    }

    const matches = candidates.filter((c) => {
      const a = c.account.tokenAMint.toBase58();
      const b = c.account.tokenBMint.toBase58();
      return (a === mintA && b === mintB) || (a === mintB && b === mintA);
    });

    let bestLiquidity: BN | null = null;
    let result: PublicKey | null = null;
    for (const match of matches) {
      try {
        const instance = await AmmImpl.create(this.connection, match.publicKey);
        this.instanceCache.set(match.publicKey.toBase58(), instance);
        const liquidityOfMintA =
          instance.tokenAMint.address.toBase58() === mintA ? instance.poolInfo.tokenAAmount : instance.poolInfo.tokenBAmount;
        if (!bestLiquidity || liquidityOfMintA.gt(bestLiquidity)) {
          bestLiquidity = liquidityOfMintA;
          result = match.publicKey;
        }
      } catch (err) {
        logger.warn(`Meteora Dynamic AMM: failed to load pool ${match.publicKey.toBase58()}: ${(err as Error).message}`);
      }
    }

    this.poolCache.set(cacheKey, result);
    return result;
  }

  async getQuote(tokenIn: Token, tokenOut: Token, amountInUi: number): Promise<DexQuote | null> {
    try {
      const poolAddress = await this.findPool(tokenIn.mint, tokenOut.mint);
      if (!poolAddress) return null;

      const key = poolAddress.toBase58();
      const instance = this.instanceCache.get(key) ?? (await AmmImpl.create(this.connection, poolAddress));
      this.instanceCache.set(key, instance);
      await instance.updateState();

      const amountInRaw = new BN(Math.round(amountInUi * 10 ** tokenIn.decimals).toString());
      const quote = instance.getSwapQuote(new PublicKey(tokenIn.mint), amountInRaw, 0);
      const amountOutUi = Number(quote.swapOutAmount.toString()) / 10 ** tokenOut.decimals;

      if (!Number.isFinite(amountOutUi) || amountOutUi <= 0) return null;
      return { dex: this.name, amountOutUi, poolId: key };
    } catch (err) {
      logger.warn(`Meteora Dynamic AMM: failed to quote ${tokenIn.symbol}->${tokenOut.symbol}: ${(err as Error).message}`);
      return null;
    }
  }
}
