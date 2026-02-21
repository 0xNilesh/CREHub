# CREHub API Reference

**Base URL:** `http://localhost:4000`
**Format:** JSON over HTTP
**Auth:** None for discovery. x402 USDC payment for trigger (see `payment-flow.md`).

---

## GET /api/workflows

List all active workflow listings.

**Response:** `Workflow[]`

```json
[
  {
    "workflowId": "wf_hf_monitor_01",
    "creatorAddress": "0xf39Fd6e51aad88F6f4ce6aB8827279cffFb92266",
    "pricePerInvocation": "10000",
    "description": "Returns the health factor for an Aave v3 lending position.",
    "detailedDescription": "Given a wallet address, queries Aave v3 on Ethereum mainnet...",
    "category": "defi",
    "active": true,
    "registeredAt": "0",
    "inputs": [
      { "name": "walletAddress", "fieldType": "address", "description": "Position owner", "required": true },
      { "name": "protocol",      "fieldType": "string",  "description": "'aave' | 'compound'", "required": false }
    ],
    "outputs": [
      { "name": "healthFactor", "fieldType": "number", "description": "Ratio ≥ 1 is safe", "required": true },
      { "name": "riskLevel",    "fieldType": "string", "description": "'safe'|'warning'|'danger'", "required": true }
    ]
  }
]
```

---

## GET /api/workflows/search?q=\<query\>&limit=\<n\>

Semantic search over all workflow listings.

**Query params:**
- `q` (required) — natural language query, e.g. `"health factor aave"`, `"ETH USD price"`, `"wallet balance low"`
- `limit` (optional, default 5, max 20) — number of results

**Response:** `SearchResult[]` — same as `Workflow` but with an extra `score` field.

```json
[
  {
    "workflowId": "wf_hf_monitor_01",
    "score": 0.91,
    "pricePerInvocation": "10000",
    "description": "Returns the health factor for an Aave v3 lending position.",
    "inputs": [...],
    "outputs": [...]
  }
]
```

`score` is cosine similarity (0–1). Results sorted highest first.
**Prefer results with score > 0.5.**

---

## GET /api/workflows/:workflowId

Fetch a single workflow by ID.

**Response:** `Workflow` (same shape as above)
**404** if not found: `{ "error": "Workflow 'wf_xyz' not found" }`

---

## POST /api/trigger/:workflowId

Trigger a workflow execution. This endpoint uses **x402 payment** — expect a `402` on first call.

**Request body:** JSON object with keys matching `workflow.inputs[].name`

```json
{ "walletAddress": "0xYourWalletHere", "protocol": "aave" }
```

**Headers (second call only):**
```
X-Payment: <ethereum_sepolia_usdc_tx_hash>
Content-Type: application/json
```

### Response: 402 Payment Required (first call)

```json
{
  "paymentDetails": {
    "network": "ethereum-sepolia",
    "chainId": 11155111,
    "payTo": "0xPLATFORM_WALLET",
    "amount": "10000",
    "token": "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"
  }
}
```

Follow `references/payment-flow.md` to complete payment and retry.

### Response: 200 Success

```json
{
  "success": true,
  "output": {
    "healthFactor": 2.4,
    "riskLevel": "safe"
  },
  "settlementTx": "0xabc123..."
}
```

### Response: 200 Failure (workflow executed but returned error)

```json
{
  "success": false,
  "error": "Invalid wallet address",
  "settlementTx": "0xdef456..."
}
```

On failure: 99% of `pricePerInvocation` is refunded to the agent wallet automatically.

### Error codes

| Status | Meaning |
|--------|---------|
| 402 | Payment required — follow x402 flow |
| 400 | Bad request — missing required input fields |
| 404 | Workflow not found |
| 500 | Internal server error |

---

## POST /api/workflows/list

Creator endpoint — register a new workflow listing (demo: in-memory).

**Request body:**
```json
{
  "workflowId": "wf_my_skill_01",
  "pricePerInvocation": "5000",
  "description": "One-line description ≤ 160 chars",
  "detailedDescription": "Full markdown description",
  "category": "defi",
  "creatorAddress": "0xYourAddress",
  "inputs": [
    { "name": "param1", "fieldType": "string", "description": "...", "required": true }
  ],
  "outputs": [
    { "name": "result", "fieldType": "number", "description": "...", "required": true }
  ]
}
```

**Response 201:**
```json
{
  "message": "Workflow listed (demo: in-memory).",
  "workflow": { ... }
}
```

**Response 409:** workflow ID already exists.
