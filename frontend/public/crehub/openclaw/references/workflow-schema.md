# Workflow Data Schema

## Workflow object

Returned by `GET /api/workflows` and `GET /api/workflows/:id`.

```typescript
interface Workflow {
  workflowId:          string            // unique identifier, e.g. "wf_hf_monitor_01"
  creatorAddress:      string            // EVM address of the workflow creator
  pricePerInvocation:  string            // USDC wei as string (6 decimals)
  description:         string            // one-liner ≤ 160 chars
  detailedDescription: string            // full markdown description
  category:            Category          // "defi" | "monitoring" | "data" | "compute"
  active:              boolean           // false = delisted, do not trigger
  registeredAt:        string            // unix timestamp as string
  inputs:              WorkflowIOField[]
  outputs:             WorkflowIOField[]
}

interface WorkflowIOField {
  name:       string    // key name used in trigger request body / output object
  fieldType:  FieldType // "string" | "number" | "boolean" | "address"
  description: string
  required:   boolean   // if false, field can be omitted from trigger body
}

type Category  = "defi" | "monitoring" | "data" | "compute"
type FieldType = "string" | "number" | "boolean" | "address"
```

## SearchResult object

Returned by `GET /api/workflows/search`. Extends `Workflow` with a similarity score.

```typescript
interface SearchResult extends Workflow {
  score: number   // cosine similarity 0–1, higher is better match
}
```

---

## Price format

`pricePerInvocation` is in **USDC wei** (USDC has 6 decimal places):

| Raw value | USDC amount |
|-----------|-------------|
| `"1000"`  | $0.001 |
| `"5000"`  | $0.005 |
| `"10000"` | $0.01  |
| `"100000"` | $0.10 |
| `"1000000"` | $1.00 |

To convert: `usd = Number(pricePerInvocation) / 1_000_000`

---

## Building a trigger request body

Use the workflow's `inputs` array to construct the POST body:

```typescript
// Given workflow.inputs:
// [
//   { name: "walletAddress", fieldType: "address", required: true },
//   { name: "protocol",      fieldType: "string",  required: false }
// ]

const body = {
  walletAddress: "0xYourWalletAddress",   // required
  // protocol: "aave"                     // optional — omit if not needed
}
```

Rules:
- Include all fields where `required: true`
- Values must match `fieldType`:
  - `address` — `0x` prefixed hex string, 42 chars
  - `number` — JavaScript number (not string)
  - `boolean` — `true` or `false`
  - `string` — any string value

---

## Reading trigger output

The `output` object in a success response has keys matching `workflow.outputs[].name`:

```typescript
// Given workflow.outputs:
// [
//   { name: "healthFactor", fieldType: "number" },
//   { name: "riskLevel",    fieldType: "string" }
// ]

const result = response.output
// result.healthFactor → 2.4
// result.riskLevel    → "safe"
```

---

## Available workflows (demo)

| workflowId | Category | Price | Description |
|------------|----------|-------|-------------|
| `wf_hf_monitor_01` | defi | $0.01 | Aave v3 health factor for a lending position |
| `wf_price_feed_01` | data | $0.005 | Chainlink price feed (any pair) |
| `wf_wallet_monitor_01` | monitoring | $0.008 | ETH balance monitor with alert threshold |
| `wf_proof_of_reserve_01` | defi | $0.015 | Chainlink Proof of Reserve verifier |
| `wf_gas_estimator_01` | compute | $0.003 | Gas price tiers via Chainlink Fast Gas feed |
| `wf_nft_floor_01` | data | $0.006 | NFT collection floor price via Chainlink feeds |
