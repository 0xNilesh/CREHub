# CREHub – Phase-wise Architecture

**Decentralized marketplace where creators monetize Chainlink CRE workflows as premium, reusable skills. AI agents discover, pay via x402 micropayments, and consume verifiable orchestration capabilities.**

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    OPENCLAW AGENT  (via SKILL.md)                       │
│     semantic search → select → x402 pay → receive { output, tx }       │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │ HTTP
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     MARKETPLACE LAYER  [Phase 4 + 5]                    │
│    Frontend (Next.js)  ◄──►  Backend API (REST + Semantic Search)       │
│       reads WorkflowRegistry contract for metadata & ownership          │
│       WorkflowMetadata: workflowId, creatorAddress, pricePerInvocation, │
│       description, inputs[], outputs[], category                        │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │ POST /trigger/:workflowId
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│             x402 PAYMENT GATEWAY  [Phase 2 – TypeScript]                │
│    Express + manual USDC verifier (viem, Ethereum Sepolia)              │
│    HTTP 402 → Agent pays USDC → verifyEthSepoliaPayment → 200          │
│    Creates ETH-signed JWT → forwards to CRE Gateway                     │
│    Calls SettlementVault.createEscrow() → settle*() after simulate     │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │ POST (JSON-RPC + Bearer JWT)
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                   CRE GATEWAY  (Chainlink-managed)                      │
│         Verifies ECDSA JWT → routes to correct DON workflow             │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │ HTTP Trigger (authenticated, gateway pubkey)
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│               CRE WORKFLOW LAYER  [Phase 1 – TypeScript]                │
│    TS workflow (cre-sdk) on Decentralized Oracle Network                │
│    Trigger: HTTP (authorized to CREHub gateway pubkey only)             │
│    Demo: `cre workflow simulate --target staging-settings`              │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │ simulate output / on-chain write (production)
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│           SMART CONTRACT LAYER  [Phase 3]  – Ethereum Sepolia           │
│   WorkflowRegistry.sol  ─── creator listings, metadata, pagination     │
│   SettlementVault.sol   ─── escrow hold, 90/10 success split,          │
│                              99/1 failure refund, ExecutionRecord store │
│   USDC: 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238 (Circle official)  │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │ events / settlement
                           ▼
                    Creator Wallet (USDC)  +  Treasury (protocol fees)
```

---

## Workflow Metadata Schema

Stored on-chain in `WorkflowRegistry.sol` and returned by the backend API.

```typescript
interface WorkflowMetadata {
  workflowId: string;              // CRE workflow ID
  creatorAddress: `0x${string}`;   // EVM address of the creator
  pricePerInvocation: string;      // USDC amount in wei (e.g. "10000" = $0.01)
  description: string;             // ≤ 160 chars, one-liner
  detailedDescription: string;     // markdown, full capability description
  inputs: WorkflowIOField[];       // ordered list of expected input fields
  outputs: WorkflowIOField[];      // ordered list of output fields
  category: string;                // "defi" | "monitoring" | "data" | "compute"
  active: boolean;
}

interface WorkflowIOField {
  name: string;           // e.g. "walletAddress"
  type: string;           // "string" | "number" | "boolean" | "address"
  description: string;
  required: boolean;
}
```

**Example (Health Factor Monitor):**
```json
{
  "workflowId": "wf_hf_monitor_01",
  "creatorAddress": "0xAbCd...",
  "pricePerInvocation": "10000",
  "description": "Returns the health factor for an Aave v3 lending position.",
  "inputs": [
    { "name": "walletAddress", "type": "address", "description": "Position owner", "required": true },
    { "name": "protocol",      "type": "string",  "description": "'aave' | 'compound'", "required": false }
  ],
  "outputs": [
    { "name": "healthFactor", "type": "number", "description": "Ratio ≥ 1 is safe",          "required": true },
    { "name": "riskLevel",    "type": "string", "description": "'safe'|'warning'|'danger'",   "required": true }
  ],
  "category": "defi",
  "active": true
}
```

---

## Settlement & Fee Split

Every triggered workflow goes through a two-step escrow pattern managed by `SettlementVault.sol`:

```
Agent pays USDC
    │
    ▼
createEscrow()  →  ExecutionRecord stored (status: pending)
                →  emit ExecutionTriggered(executionId, workflowId, agentAddr, pricePaid, inputsJson)
    │
    ▼
cre workflow simulate  (or on-chain DON execution in production)
    │
    ├── success=true  →  settleSuccess()
    │       USDC.transfer(creator,  amount * 90 / 100)   // 90% → creator
    │       USDC.transfer(treasury, amount * 10 / 100)   // 10% → protocol
    │       emit ExecutionSettled(..., success=true, outputsJson)
    │
    └── success=false  →  settleFailure()
            USDC.transfer(agent,    amount * 99 / 100)   // 99% refund → agent
            USDC.transfer(treasury, amount *  1 / 100)   // 1% ops fee
            emit ExecutionSettled(..., success=false, errorMessage)
```

**Explorer events (fully indexed):**
```solidity
event ExecutionTriggered(
    bytes32 indexed executionId,
    string  indexed workflowId,
    address indexed agentAddress,
    uint256         pricePaid,
    string          inputsJson,
    uint256         triggeredAt
);

event ExecutionSettled(
    bytes32 indexed executionId,
    string  indexed workflowId,
    address indexed agentAddress,
    address         creatorAddress,
    uint256         pricePaid,
    uint256         creatorPayout,
    uint256         protocolFee,
    uint256         agentRefund,
    bool            success,
    string          outputsJson,
    string          errorMessage,
    uint256         settledAt
);
```

---

## Phase 1 – CRE Workflow Layer (TypeScript)

**Goal:** Creator-authored TypeScript workflows HTTP-triggered exclusively by the CREHub gateway.

**Location:** `cre-workflow-template/` (fork-ready template for creators)

```
src/workflow.ts   – HTTP trigger locked to CREHub gateway public key
workflow.yaml     – CRE CLI targets (staging + production)
config.json       – WorkflowMetadata template (creators fill in)
package.json
```

**Execution flow:**
```
HTTP Trigger  (only authorized key: CREHUB_GATEWAY_PUBKEY)
    │
    ▼
handler(config, runtime, payload)
    │  payload.input = { ...WorkflowInput fields }
    │  runtime.http() for external API calls
    │  runtime.evm() for on-chain reads
    ▼
WorkflowOutput  →  returned to gateway  →  settle on-chain
```

**Key design decisions:**
- `httpTrigger({ authorizedKeys: [{ type: KeyType.ECDSA_EVM, publicKey: CREHUB_GATEWAY_PUBKEY }] })` — only the CREHub gateway can fire a workflow
- Config-driven metadata via `config.json` — same file registered in `WorkflowRegistry`
- Demo runs via `cre workflow simulate --target staging-settings` — no on-chain DON deployment needed

**Networks configured (`workflow.yaml`):**

| Target | Path |
|--------|------|
| staging | `./src/workflow.ts` + `./config.json` |
| production | `./src/workflow.ts` + `./config.json` |

---

## Phase 2 – x402 Payment Gateway (TypeScript)

**Goal:** Enforce pay-per-trigger with USDC micropayments on Ethereum Sepolia, run `cre simulate`, and settle escrow on-chain.

**Location:** `gateway/`

```
src/index.ts     – Express server, verifyEthSepoliaPayment middleware, routes
src/jwt.ts       – ETH-signed JWT (TS port of utils.py)
src/payment.ts   – createEscrow → cre simulate → settle*()
src/simulate.ts  – shell runner for `cre workflow simulate`
src/types.ts     – WorkflowMetadata, SimulateResult, ExecutionResult
package.json
.env.example
```

### Manual payment verifier (Ethereum Sepolia)

The x402 SDK's built-in middleware covers Base / Base Sepolia only. For Ethereum Sepolia we use a **lightweight manual verifier**:

```
Agent → POST /trigger/:workflowId  (no X-PAYMENT)
    ← 402  { paymentDetails: { network, chainId: 11155111, payTo, amount, token } }

Agent broadcasts USDC transfer on Ethereum Sepolia
Agent → POST /trigger/:workflowId  (X-PAYMENT: <txHash>)
    → verifyEthSepoliaPayment():
        getTransactionReceipt(txHash) via viem publicClient
        verify USDC Transfer log (to == PLATFORM_WALLET, value >= price)
    → holdAndExecute():
        SettlementVault.createEscrow()   ← emits ExecutionTriggered
        cre workflow simulate            ← runs locally
        SettlementVault.settle*()        ← emits ExecutionSettled
    ← 200  { success, output, settlementTx }
```

### JWT creation for CRE Gateway auth (`jwt.ts`)

```
Header:  { "alg": "ETH", "typ": "JWT" }
Payload: {
    "digest": "0x" + sha256(jsonrpc_request),   ← request integrity
    "iss":    gateway_wallet_address,
    "iat":    now,
    "exp":    now + 300,                          ← 5-minute TTL
    "jti":    uuid()                              ← replay prevention
}
Signature: ethers.Wallet.signMessageSync(header.payload)  ← ECDSA/secp256k1
```

### Environment variables

```
PLATFORM_WALLET=0x...          # receives x402 payment
TREASURY_WALLET=0x...          # receives protocol fees
GATEWAY_PRIVATE_KEY=0x...      # signs CRE JWTs
CREHUB_GATEWAY_PUBKEY=0x...    # used in workflow templates (AuthorizedKey)
SETTLEMENT_VAULT_ADDRESS=0x...
WORKFLOW_REGISTRY_ADDRESS=0x...
CRE_GATEWAY_URL=https://...
USDC_ADDRESS=0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
PORT=8080
```

### API surface

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /health` | None | Health check |
| `GET /workflows` | None | Proxy to marketplace backend |
| `POST /trigger/:workflowId` | x402 USDC payment (Eth Sepolia) | Trigger CRE workflow |

---

## Phase 3 – Smart Contracts (Ethereum Sepolia)

**Location:** `contracts/`

```
src/WorkflowRegistry.sol   – on-chain listing registry + execution history index
src/SettlementVault.sol    – escrow, conditional split, ExecutionRecord storage
foundry.toml
```

### WorkflowRegistry.sol

- `listWorkflow(WorkflowMetadata)` — creator registers a workflow
- `getWorkflow(workflowId)` — returns full metadata
- `getWorkflowExecutions(workflowId, offset, limit)` — paginated execution history
- `getAgentExecutions(agentAddr, offset, limit)` — all executions by an agent
- Execution records written by `SettlementVault` via internal call after settlement

### SettlementVault.sol

**ExecutionRecord struct:**
```solidity
struct ExecutionRecord {
    bytes32  executionId;
    string   workflowId;
    address  agentAddress;
    address  creatorAddress;
    uint256  pricePaid;
    uint256  creatorPayout;
    uint256  protocolFee;
    uint256  agentRefund;
    string   inputsJson;
    string   outputsJson;
    string   errorMessage;
    bool     success;
    uint256  triggeredAt;
    uint256  settledAt;
}
```

**Storage:**
```solidity
mapping(bytes32 => ExecutionRecord) public executions;
mapping(string  => bytes32[])       public workflowExecutions;
mapping(address => bytes32[])       public agentExecutions;
uint256 public totalExecutions;
```

**Explorer view functions:**
```
getExecution(executionId)                    → ExecutionRecord
getWorkflowExecutions(workflowId, off, lim)  → ExecutionRecord[]
getAgentExecutions(agentAddr, off, lim)      → ExecutionRecord[]
getRecentExecutions(offset, limit)           → ExecutionRecord[]
getTotalExecutions()                         → uint256
getWorkflowStats(workflowId)                 → { totalRuns, successRuns, totalVolume, avgPrice }
```

**Trust model (demo):** Gateway is the trusted caller of `settle*()`. For production: use CRE Keystone report as proof of execution.

---

## Phase 4 – Marketplace Backend API (TODO)

**Goal:** REST API that aggregates on-chain data, serves semantic search, and routes agent triggers through the gateway.

**Stack:** Node.js / Express — deployed on Render/Railway (persistent, avoids cold starts)

### API surface

```
GET  /api/workflows                     → list all active listings (from Registry)
GET  /api/workflows/:workflowId         → workflow detail + metadata
GET  /api/workflows/search?q=<query>    → semantic search (embedding similarity)
POST /api/trigger/:workflowId           → proxies to gateway (handles 402 ↔ agent)
POST /api/workflows/list                → creator submits new workflow listing
```

### Semantic search

```
1. Startup: fetch all listings from WorkflowRegistry
2. Embed (name + description + category) via sentence-transformers
3. On query: embed → cosine similarity → top-K
```

---

## Phase 5 – Marketplace Frontend (TODO)

**Stack:** Next.js 14 (App Router) + Tailwind CSS + Wagmi + RainbowKit

### Pages

```
/                     → landing page
/browse               → search/filter all listings
/workflow/:id         → detail (price, inputs/outputs, trigger button)
/list                 → creator: fill config.json fields → sign + submit
/my-workflows         → creator: view owned listings
```

---

## Phase 6 – Demo Flow with `cre simulate`

**Goal:** Full end-to-end demo without on-chain DON deployment.

```
1. Creator:
   - Forks cre-workflow-template/
   - Implements handler() (e.g. Health Factor Monitor)
   - Fills in config.json (workflowId, price, inputs/outputs)
   - Calls WorkflowRegistry.listWorkflow() on Ethereum Sepolia

2. Gateway starts (npm run dev in gateway/):
   - cre-workflow-template/ checked out on gateway server
   - Gateway knows workflowDir path per workflowId

3. Openclaw agent (using SKILL.md):
   - Searches: GET /api/workflows/search?q=health+factor
   - Selects workflow, reads inputs/outputs/pricePerInvocation
   - POST /trigger/wf_hf_monitor_01 { walletAddress: "0x..." }
   - Receives 402 → pays USDC on Ethereum Sepolia → retries with X-PAYMENT

4. Gateway:
   - verifyEthSepoliaPayment(): checks USDC Transfer log via viem
   - SettlementVault.createEscrow()  →  emits ExecutionTriggered
   - `cre workflow simulate --target staging-settings --input '{"walletAddress":"0x..."}'`
   - Captures: { healthFactor: 2.4, riskLevel: "safe" }

5. Settlement:
   - success=true → settleSuccess()
     → 90% USDC to creator wallet
     → 10% to treasury
   - Returns { success: true, output: { healthFactor: 2.4, riskLevel: "safe" }, settlementTx: "0x..." }

6. Openclaw logs:
   - "Health factor: 2.4 – position safe"
   - "Paid $0.01 USDC, settlement tx: 0x..."
```

### Demo verification checklist

```
[ ] cre-workflow-template compiles: tsc --noEmit
[ ] `cre workflow simulate` runs with sample input
[ ] Gateway starts: npm run dev in gateway/
[ ] POST /trigger returns 402 with paymentDetails
[ ] Retry with X-PAYMENT header → 200 + { success, output, settlementTx }
[ ] Failure input → 99% returned, 1% retained
[ ] settleSuccess emits ExecutionSettled(success=true, outputsJson, creatorPayout=90%)
[ ] settleFailure emits ExecutionSettled(success=false, errorMessage, agentRefund=99%)
[ ] createEscrow emits ExecutionTriggered(inputsJson, triggeredAt)
[ ] getRecentExecutions() returns both success + failure records
[ ] Openclaw agent: SKILL.md → discover → pay → log output
```

---

## Dependency Graph

```
Phase 1 (CRE Workflow Template – TypeScript)   ← template ready to fork
    │
    └──► Phase 2 (TypeScript x402 Gateway)     ← runs cre simulate, settles escrow
              │
              ├──► Phase 3 (Contracts – Eth Sepolia)   ← WorkflowRegistry + SettlementVault
              │         │
              │         ├──► Phase 4 (Backend API)     ← blocks Phase 5 + 6
              │         │         │
              │         │         ├──► Phase 5 (Frontend)
              │         │         │
              │         │         └──► Phase 6 (Agent Demo via SKILL.md)
              │         │
              └─────────┴──────────────► Phase 7 (Integration + Deploy)
```

---

## Key Technical Decisions

| Decision | Choice | Rationale |
|---------|--------|-----------|
| Workflow language | TypeScript | CRE SDK supports TS; aligns with gateway stack |
| Payment network | Ethereum Sepolia (chainId 11155111) | Matches project.yaml staging config |
| x402 payment verifier | Manual viem verifier (not x402 middleware) | x402 SDK only covers Base/Base-Sepolia natively |
| USDC contract | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` | Circle official USDC on Sepolia |
| Demo execution | `cre workflow simulate` only | No DON deployment needed for hackathon demo |
| JWT auth for CRE | ETH-signed JWT (ECDSA) | CRE gateway requires this specific format; ported from utils.py |
| Settlement | SettlementVault.sol (escrow) | On-chain proof of payment + verifiable fee split |
| Fee split (success) | 90% creator / 10% protocol | Rewards creators, sustains protocol |
| Fee split (failure) | 99% agent refund / 1% ops | Penalises bad workflows minimally; protects agents |
| Agent interface | SKILL.md (agentskills.io spec) | Openclaw-native; standardised discovery + trigger |
| Secret management | `.env` (local) | Simple for demo; extend to Secret Manager for production |
| CRE workflow trigger lock | `AuthorizedKey` = `CREHUB_GATEWAY_PUBKEY` | Only CREHub gateway can fire creator workflows |
