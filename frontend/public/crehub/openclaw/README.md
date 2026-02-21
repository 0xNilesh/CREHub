# CREHub Marketplace — Openclaw Skill

An [Openclaw](https://agentskills.io/specification) skill that enables AI agents to discover,
pay for, and execute Chainlink CRE workflows from the CREHub marketplace.

## What this skill does

- **Discover** — semantic search over CRE workflow listings
- **Pay** — x402 USDC micropayments on Ethereum Sepolia (pay-per-trigger)
- **Execute** — trigger workflows and receive structured outputs
- **Verify** — every execution settled on-chain via `SettlementVault.sol`

## Structure

```
SKILL.md                       ← Openclaw entry point
references/
  api.md                       ← Full API surface (endpoints + response shapes)
  payment-flow.md              ← x402 step-by-step (402 → pay USDC → retry)
  workflow-schema.md           ← Data types, price format, field definitions
examples/
  agent-demo.md                ← End-to-end example session
```

## Quick start

Point Openclaw at this directory. When the agent needs an on-chain capability
(DeFi, price data, monitoring, compute), it will:

1. Search `GET /api/workflows/search?q=<intent>`
2. Select the best match by score + price
3. Trigger via `POST /api/trigger/:workflowId` with x402 payment
4. Return structured output to the user

## Running the full stack

```bash
# From CREHub root
bash start-demo.sh
```

This starts:
- **Gateway** on `http://localhost:8080` — x402 payment + CRE simulate
- **Backend** on `http://localhost:4000` — marketplace API + semantic search
- **Frontend** on `http://localhost:3000` — marketplace UI

## Marketplace

Browse workflows at `http://localhost:3000/browse` or search directly:

```bash
curl "http://localhost:4000/api/workflows/search?q=health+factor"
```

## Fee split

| Outcome | Creator | Protocol | Agent |
|---------|---------|----------|-------|
| Success | 90% | 10% | — |
| Failure | — | 1% | 99% refund |
