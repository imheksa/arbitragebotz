import { config, pairs } from "./config.js";
import { RaydiumClient } from "./dex/raydiumClient.js";
import { OrcaClient } from "./dex/orcaClient.js";
import { scanPair } from "./arbitrage/detector.js";
import { simulateExecution } from "./arbitrage/simulator.js";
import { logger } from "./logger.js";
import type { DexClient } from "./types.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function tick(dexClients: DexClient[]): Promise<void> {
  for (const pair of pairs) {
    try {
      const result = await scanPair(pair, dexClients, config.minProfitBps, config.assumedCostBufferBps);
      if (result.opportunities.length === 0) {
        const best = result.bestNetBps === null ? "n/a" : `${result.bestNetBps.toFixed(2)} bps`;
        logger.info(`${pair.name}: no opportunity (best net spread seen: ${best})`);
        continue;
      }
      for (const opportunity of result.opportunities) {
        await simulateExecution(opportunity, config.logFile);
      }
    } catch (err) {
      logger.error(`${pair.name}: scan failed: ${(err as Error).message}`);
    }
  }
}

async function main(): Promise<void> {
  logger.info("Starting Solana inter-DEX arbitrage bot (SIMULATION MODE - no transactions are ever sent)");
  logger.info(`RPC: ${config.rpcUrl}`);
  logger.info(`Pairs: ${pairs.map((p) => p.name).join(", ")}`);
  logger.info(`Poll interval: ${config.pollIntervalMs}ms | min net profit: ${config.minProfitBps} bps`);

  const orcaClient = new OrcaClient(config.rpcUrl);
  try {
    await orcaClient.checkConnection();
  } catch (err) {
    logger.error(
      `Cannot reach SOLANA_RPC_URL (${config.rpcUrl}): ${(err as Error).message}. ` +
        `Orca quotes will silently return "no pool found" until this is fixed - check your .env.`,
    );
  }
  const dexClients: DexClient[] = [new RaydiumClient(), orcaClient];

  let running = true;
  process.on("SIGINT", () => {
    logger.info("Shutting down...");
    running = false;
  });

  while (running) {
    await tick(dexClients);
    if (running) await sleep(config.pollIntervalMs);
  }
}

main().catch((err) => {
  logger.error(`Fatal: ${(err as Error).stack ?? err}`);
  process.exit(1);
});
