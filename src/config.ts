import "dotenv/config";
import { RAYMint, USDCMint, USDTMint, WSOLMint } from "@raydium-io/raydium-sdk-v2";
import type { ArbitragePair, Token } from "./types.js";

function envString(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
}

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const SOL: Token = { symbol: "SOL", mint: WSOLMint.toBase58(), decimals: 9 };
export const USDC: Token = { symbol: "USDC", mint: USDCMint.toBase58(), decimals: 6 };
export const USDT: Token = { symbol: "USDT", mint: USDTMint.toBase58(), decimals: 6 };
export const RAY: Token = { symbol: "RAY", mint: RAYMint.toBase58(), decimals: 6 };

export const config = {
  rpcUrl: envString("SOLANA_RPC_URL", "https://api.mainnet-beta.solana.com"),
  pollIntervalMs: envInt("POLL_INTERVAL_MS", 15_000),
  minProfitBps: envInt("MIN_PROFIT_BPS", 15),
  assumedCostBufferBps: envInt("ASSUMED_COST_BUFFER_BPS", 10),
  logFile: envString("LOG_FILE", "./logs/opportunities.jsonl"),
};

/**
 * Pairs to scan. Mints come from the Raydium SDK's own exported constants
 * (not hand-typed) so they are guaranteed correct. Add pairs cautiously -
 * a wrong mint address will just fail to find pools, not corrupt results.
 */
export const pairs: ArbitragePair[] = [
  { name: "SOL/USDC", base: SOL, quote: USDC, tradeSizeUi: 1 },
  { name: "SOL/USDT", base: SOL, quote: USDT, tradeSizeUi: 1 },
  { name: "RAY/USDC", base: RAY, quote: USDC, tradeSizeUi: 50 },
];
