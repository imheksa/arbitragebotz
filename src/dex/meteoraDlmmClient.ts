import { Connection, PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { createRequire } from "node:module";
import type DLMMType from "@meteora-ag/dlmm";
import type { LbPairAccount } from "@meteora-ag/dlmm";
import type { DexClient, DexQuote, Token } from "../types.js";
import { logger } from "../logger.js";

// @meteora-ag/dlmm's ESM build does a named import of `BN` from
// @coral-xyz/anchor, but the nested anchor version it bundles exports BN
// via a property getter that Node's ESM/CJS interop can't statically
// detect, so `import DLMM from "@meteora-ag/dlmm"` throws at load time.
// Its CJS build doesn't have this problem, so load it via require instead.
const require = createRequire(import.meta.url);
const DLMM = require("@meteora-ag/dlmm") as typeof DLMMType;

/**
 * Meteora DLMM (concentrated liquidity) quotes, read on-chain via the
 * official SDK's exact bin math (`swapQuote`). Pool discovery uses
 * `DLMM.getLbPairs`, an *unfiltered* scan of every DLMM pool on the whole
 * program - the SDK has no mint-filtered alternative. It's fetched once
 * and cached for the process lifetime, but expect it to be slow on the
 * first call and to require an RPC endpoint that allows large
 * getProgramAccounts responses (most paid providers do; many free public
 * endpoints disable or rate-limit this).
 */
export class MeteoraDlmmClient implements DexClient {
  readonly name = "Meteora DLMM";
  private readonly connection: Connection;
  private allPairsPromise: Promise<LbPairAccount[]> | null = null;
  private readonly poolCache = new Map<string, { address: PublicKey; xMint: string } | null>();
  private readonly instanceCache = new Map<string, DLMMType>();

  constructor(rpcUrl: string) {
    this.connection = new Connection(rpcUrl, "confirmed");
  }

  private getAllPairs(): Promise<LbPairAccount[]> {
    if (!this.allPairsPromise) this.allPairsPromise = DLMM.getLbPairs(this.connection);
    return this.allPairsPromise;
  }

  private async findPool(mintA: string, mintB: string): Promise<{ address: PublicKey; xMint: string } | null> {
    const cacheKey = [mintA, mintB].sort().join(":");
    if (this.poolCache.has(cacheKey)) return this.poolCache.get(cacheKey) ?? null;

    const allPairs = await this.getAllPairs();
    const candidates = allPairs.filter((p) => {
      const x = p.account.tokenXMint.toBase58();
      const y = p.account.tokenYMint.toBase58();
      return (x === mintA && y === mintB) || (x === mintB && y === mintA);
    });

    let result: { address: PublicKey; xMint: string } | null = null;
    if (candidates.length > 0) {
      const instances = await DLMM.createMultiple(
        this.connection,
        candidates.map((c) => c.publicKey),
      ).catch(() => [] as DLMMType[]);

      let best: { instance: DLMMType; pubkey: PublicKey } | null = null;
      for (let i = 0; i < instances.length; i++) {
        const instance = instances[i];
        const pubkey = candidates[i].publicKey;
        this.instanceCache.set(pubkey.toBase58(), instance);
        if (!best || instance.tokenX.amount > best.instance.tokenX.amount) {
          best = { instance, pubkey };
        }
      }
      if (best) result = { address: best.pubkey, xMint: best.instance.tokenX.publicKey.toBase58() };
    }

    this.poolCache.set(cacheKey, result);
    return result;
  }

  async getQuote(tokenIn: Token, tokenOut: Token, amountInUi: number): Promise<DexQuote | null> {
    try {
      const pool = await this.findPool(tokenIn.mint, tokenOut.mint);
      if (!pool) return null;

      const dlmm = this.instanceCache.get(pool.address.toBase58()) ?? (await DLMM.create(this.connection, pool.address));
      const binArrays = await dlmm.getBinArrays();
      const swapForY = tokenIn.mint === pool.xMint;
      const amountInRaw = new BN(Math.round(amountInUi * 10 ** tokenIn.decimals).toString());

      const quote = dlmm.swapQuote(amountInRaw, swapForY, new BN(0), binArrays);
      const amountOutUi = Number(quote.outAmount.toString()) / 10 ** tokenOut.decimals;

      if (!Number.isFinite(amountOutUi) || amountOutUi <= 0) return null;
      return { dex: this.name, amountOutUi, poolId: pool.address.toBase58() };
    } catch (err) {
      logger.warn(`Meteora DLMM: failed to quote ${tokenIn.symbol}->${tokenOut.symbol}: ${(err as Error).message}`);
      return null;
    }
  }
}
