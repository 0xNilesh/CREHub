---
name: crehub-marketplace
description: >
  Enable AI agents to discover, pay for, and execute Chainlink CRE workflows
  from the CREHub marketplace using x402 USDC micropayments on Ethereum Sepolia.
  Trigger when the agent needs to: check DeFi health factors, fetch on-chain
  price feeds, monitor wallet balances, verify proof of reserve, estimate gas,
  or any other capability listed in the CREHub marketplace.
license: MIT
compatibility: Designed for Openclaw and AI agents that implement https://agentskills.io/specification
allowed-tools: WebFetch Bash Read
metadata:
  purpose: CREHub marketplace discovery, x402 payment, and CRE workflow execution
  marketplace_url: http://localhost:4000
  version: "0.1"
---

# CREHub Marketplace Skill

Allow the agent to discover and trigger Chainlink CRE workflows as premium skills,
paying per execution with USDC micropayments on Ethereum Sepolia.

## Runtime Pattern

When the agent needs a capability (e.g. "check health factor", "get ETH/USD price"):

1. **Search the marketplace** — query `GET /api/workflows/search?q=<intent>` to find matching workflows
2. **Select the best match** — read `description`, `inputs`, `outputs`, `pricePerInvocation`
3. **Trigger with x402 payment** — POST → handle 402 → pay USDC → retry with `X-Payment`
4. **Parse and return result** — extract `output` fields defined in the workflow schema

Always read `references/api.md` for endpoint details and `references/payment-flow.md` for the full x402 step-by-step before triggering.

## Reference Files

| File | Topic | When to use |
|------|-------|-------------|
| [api.md](references/api.md) | CREHub API surface | All endpoint URLs, request/response shapes, error codes |
| [payment-flow.md](references/payment-flow.md) | x402 payment flow | Step-by-step USDC payment on Ethereum Sepolia |
| [workflow-schema.md](references/workflow-schema.md) | Workflow data schema | Field types, price format, input/output definitions |

## Live URLs

| Resource | URL |
|----------|-----|
| **This skill (entry point)** | `http://localhost:4000/skill.md` |
| API reference | `http://localhost:4000/skill/references/api.md` |
| Payment flow | `http://localhost:4000/skill/references/payment-flow.md` |
| Workflow schema | `http://localhost:4000/skill/references/workflow-schema.md` |
| Agent demo | `http://localhost:4000/skill/examples/agent-demo.md` |
| Web agent console | `http://localhost:3000/agent` |

## Quick Reference

```
Base URL:  http://localhost:4000
Search:    GET  /api/workflows/search?q=<query>&limit=5
List all:  GET  /api/workflows
Detail:    GET  /api/workflows/:workflowId
Trigger:   POST /api/trigger/:workflowId   (x402 — see payment-flow.md)
```

## Decision Rules

- **Prefer semantic search** over listing all workflows — use a descriptive query matching the agent's goal
- **Always check `inputs` before triggering** — build the request body from `inputs[].name` fields
- **Price gate** — if `pricePerInvocation` exceeds the agent's budget, skip and try next result
- **On 402** — do NOT abort; this is expected. Follow the payment flow in `references/payment-flow.md`
- **On failure response** — 99% of payment is automatically refunded; log `errorMessage` and try an alternative workflow

## Tips

- `pricePerInvocation` is in USDC wei (6 decimals). `10000` = $0.01 USDC.
- The `score` field in search results is cosine similarity (0–1). Prefer results with score > 0.5.
- Input fields with `required: false` can be omitted from the trigger body.
- The `settlementTx` in the success response is an Ethereum Sepolia tx hash — verifiable on Etherscan Sepolia.
