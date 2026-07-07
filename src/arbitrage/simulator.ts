import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { ArbitrageOpportunity } from "../types.js";
import { logger } from "../logger.js";

let logDirReady: Promise<void> | null = null;

async function ensureLogDir(logFile: string): Promise<void> {
  if (!logDirReady) logDirReady = mkdir(dirname(logFile), { recursive: true }).then(() => undefined);
  await logDirReady;
}

/**
 * "Executes" an opportunity in paper-trading mode: no transaction is ever
 * built or signed. It is logged to stdout and appended to a JSONL file so
 * results can be reviewed/backtested later.
 */
export async function simulateExecution(opportunity: ArbitrageOpportunity, logFile: string): Promise<void> {
  logger.info(
    `OPPORTUNITY ${opportunity.pair}: buy on ${opportunity.buyDex}, sell on ${opportunity.sellDex} | ` +
      `in ${opportunity.amountInUi} -> out ${opportunity.amountOutUi.toFixed(6)} | ` +
      `net ${opportunity.netProfitBps.toFixed(2)} bps (gross ${opportunity.grossProfitBps.toFixed(2)} bps)`,
  );

  try {
    await ensureLogDir(logFile);
    await appendFile(logFile, JSON.stringify(opportunity) + "\n", "utf8");
  } catch (err) {
    logger.error(`Failed to write opportunity log: ${(err as Error).message}`);
  }
}
