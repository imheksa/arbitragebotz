# arbitragebotz

Inter-DEX arbitrage **detection** bot for Solana tokens. It watches the same
token pair across Raydium and Orca, and whenever the round-trip spread
(buy on one DEX, sell on the other) clears a configurable threshold, it logs
the opportunity.

**This runs in simulation / paper-trading mode only.** It never builds,
signs, or sends a transaction, and it never touches a private key or wallet
funds. It only reads public price data and prints/logs what a round trip
*would* have earned.

## How it works

1. For each configured pair (e.g. `SOL/USDC`), it fetches a quote for
   swapping a fixed amount of the base token into the quote token on every
   configured DEX.
2. For every `(buyDex, sellDex)` combination, it takes the quote-token
   amount from the "buy" leg and quotes swapping it back into the base
   token on the "sell" leg.
3. `net spread = (final base amount - starting base amount) / starting amount`,
   minus a flat `ASSUMED_COST_BUFFER_BPS` buffer that stands in for network
   fees, priority fees, and price drift between the two swaps.
4. If the net spread clears `MIN_PROFIT_BPS`, the opportunity is printed and
   appended as a JSON line to `LOG_FILE`.

### Price sources

- **Raydium**: Raydium's public pools API (via the official SDK's `Api`
  client — a plain HTTP client, no RPC connection required). The swap
  output is approximated with the constant-product AMM formula against the
  pool's reported reserves and fee rate. This is exact for standard AMM
  pools and an approximation for concentrated-liquidity (CLMM) pools.
- **Orca**: read directly on-chain via the official Whirlpool SDK
  (`swapQuoteByInputToken`), which does exact concentrated-liquidity swap
  math. This needs a working Solana RPC endpoint (`SOLANA_RPC_URL`).

## Setup

```bash
npm install
cp .env.example .env
# edit .env - at minimum set SOLANA_RPC_URL to a real RPC endpoint
# (the public api.mainnet-beta.solana.com endpoint is heavily rate-limited
# and may reject requests; a free key from Helius/QuickNode/Triton etc. is
# recommended)
npm run dev
```

You should see log lines like:

```
[...] INFO  SOL/USDC: no opportunity (best net spread seen: -8.42 bps)
[...] INFO  OPPORTUNITY SOL/USDT: buy on Raydium, sell on Orca | in 1 -> out 1.0021 | net 18.30 bps (gross 28.30 bps)
```

> This project was scaffolded and typechecked in a sandboxed environment
> with no outbound access to Solana RPC endpoints or DEX APIs, so the
> network calls above could not be exercised live. Run it locally with a
> real RPC URL and confirm the numbers look sane before relying on it.

## Configuration (`.env`)

| Variable                  | Default                              | Meaning                                              |
| -------------------------- | ------------------------------------- | ----------------------------------------------------- |
| `SOLANA_RPC_URL`           | `https://api.mainnet-beta.solana.com` | RPC endpoint used for Orca on-chain reads             |
| `POLL_INTERVAL_MS`         | `15000`                               | How often to rescan all pairs                         |
| `MIN_PROFIT_BPS`           | `15`                                  | Minimum net spread (bps) to log as an opportunity     |
| `ASSUMED_COST_BUFFER_BPS`  | `10`                                  | Flat buffer subtracted from gross spread (see below)  |
| `LOG_FILE`                 | `./logs/opportunities.jsonl`          | Where opportunities are appended as JSON lines        |

Pairs and per-pair trade size are defined in `src/config.ts` (`pairs`
array). Token mints there are pulled from the Raydium SDK's own exported
constants, not hand-typed, to avoid typo risk. Add pairs cautiously — a
wrong mint just means "no pool found", but always double-check on a
Solana explorer before trusting a new pair's output.

## Known simplifications

- `ASSUMED_COST_BUFFER_BPS` is a flat estimate, not a real fee model. A real
  round trip costs two transactions' worth of network/priority fees (in
  SOL) plus whatever the price moves between the two swaps landing on
  different blocks. Before ever moving toward live execution, replace this
  with an actual fee/slippage model.
- Raydium quotes use constant-product math against reported reserves, which
  is approximate for CLMM pools.
- Only "standard" (non-adaptive-fee) Orca Whirlpools are checked.
- This bot never executes trades. Going from detection to live execution on
  Solana mainnet involves real risk: slippage between the two legs,
  transaction failures leaving you part-filled, MEV/front-running, and
  outright loss of funds from bugs. Treat that as a separate, much larger
  project with its own review — don't wire up a live wallet by copying this
  code without independently verifying every part of the execution path.

## Scripts

- `npm run dev` — run with auto-restart on file changes
- `npm start` — run once (no watch)
- `npm run build` — compile to `dist/`
- `npm run typecheck` — type-check without emitting
