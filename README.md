# CREHub

**Decentralized marketplace where creators monetize Chainlink CRE workflows as premium, reusable AI agent skills — paid per trigger with USDC micropayments on Ethereum Sepolia.**

AI agents discover workflows via semantic search, pay with USDC (x402 protocol), and receive verifiable on-chain settled results. Creators earn 90% of every successful execution.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    OPENCLAW AGENT  (via SKILL.md)                       │
│     semantic search → select → x402 pay → receive { output, tx }       │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │ HTTP
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                     MARKETPLACE LAYER                                   │
│    Frontend (Next.js 14)  ◄──►  Backend API (Express + Semantic Search) │
│    /browse  /list  /workflow/:id  /crehub/openclaw                      │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │ POST /api/trigger/:workflowId
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                   x402 PAYMENT GATEWAY  (TypeScript)                    │
│    HTTP 402 → Agent pays USDC → verifyEthSepoliaPayment → 200          │
│    Creates ETH-signed JWT → runs cre workflow simulate                 │
│    Calls SettlementVault.createEscrow() → settle*() after execution    │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │ POST (JSON-RPC + Bearer JWT)
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                   CRE GATEWAY  (Chainlink-managed)                      │
│         Verifies ECDSA JWT → routes to correct DON workflow             │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │ HTTP Trigger
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│               CRE WORKFLOW  (TypeScript, Chainlink CRE SDK)             │
│    Demo: cre workflow simulate --target staging-settings               │
└──────────────────────────┬──────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────────┐
│           SMART CONTRACT LAYER  — Ethereum Sepolia                      │
│   WorkflowRegistry.sol  — on-chain listing registry                    │
│   SettlementVault.sol   — escrow, 90/10 success, 99/1 failure refund   │
│   USDC: 0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238                    │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Repository Structure

```
CREHub/
├── gateway/                    # Phase 2 — x402 Payment Gateway (TypeScript/Bun)
├── backend/                    # Phase 4 — Marketplace Backend API (TypeScript/Bun)
├── frontend/                   # Phase 5 — Marketplace Frontend (Next.js 14)
├── contracts/                  # Phase 3 — Smart Contracts (Solidity/Foundry)
├── cre-workflow-template/      # Phase 1 — Creator workflow template (CRE SDK)
├── openclaw/                   # Phase 6 — Openclaw SKILL.md (separate repo)
├── chainlink-agent-skills/     # CRE developer skills (git submodule)
├── cre-sdk-typescript/         # CRE TypeScript SDK (git submodule)
├── cre_x402_smartcon_demo/     # Reference demo (Python gateway + Go workflow)
├── start-demo.sh               # One-command full stack launcher
├── ARCHITECTURE.md             # Full phase-by-phase architecture spec
└── package.json                # Root Bun workspace
```

---

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) >= 1.2.21
- [Foundry](https://getfoundry.sh) (for contracts)
- Node.js 18+ (for Next.js)

### One-command demo

```bash
# Install all dependencies
bun install

# Copy and fill environment files
cp gateway/.env.example gateway/.env
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local

# Start everything (gateway :8080 + backend :4000 + frontend :3000)
bash start-demo.sh
```

Then open:
- **Marketplace UI** → http://localhost:3000
- **Browse workflows** → http://localhost:3000/browse
- **Agent Skills (Openclaw)** → http://localhost:3000/crehub/openclaw
- **Backend API** → http://localhost:4000/api/workflows
- **Sitemap** → http://localhost:3000/sitemap.xml

---

## Phases

### Phase 1 — CRE Workflow Template (`cre-workflow-template/`)

Creator-authored TypeScript workflows using the Chainlink CRE SDK. HTTP-triggered exclusively by the CREHub gateway key.

```
src/index.ts       — HTTP trigger, locked to CREHUB_GATEWAY_PUBKEY
config.json        — WorkflowMetadata (workflowId, price, inputs, outputs)
workflow.yaml      — CRE CLI targets (staging + production)
```

**Run demo simulation:**
```bash
cd cre-workflow-template
bun test
```

**Key design:** `httpTrigger({ authorizedKeys: [{ type: KeyType.ECDSA_EVM, publicKey: CREHUB_GATEWAY_PUBKEY }] })` — only the CREHub gateway can fire a workflow.

---

### Phase 2 — x402 Payment Gateway (`gateway/`)

Express server that enforces pay-per-trigger USDC micropayments on Ethereum Sepolia, runs `cre workflow simulate`, and settles escrow on-chain.

```
src/index.ts       — Express routes (GET /health, GET /workflows, POST /trigger/:id)
src/payment.ts     — createPaymentMiddleware, verifyUSDCTransfer, holdAndExecute
src/jwt.ts         — ETH-signed JWT for CRE Gateway auth (ECDSA/secp256k1)
src/simulate.ts    — Shell runner for `cre workflow simulate`
src/settlement.ts  — SettlementVault client (LoggingSettlementClient for demo)
src/types.ts       — WorkflowMetadata, PaymentDetails, SimulateResult
```

**Payment flow:**
```
Agent POST /trigger/:id   →   402 { paymentDetails }
Agent broadcasts USDC transfer on Ethereum Sepolia
Agent POST /trigger/:id + X-Payment: <txHash>
Gateway verifies USDC Transfer log via viem
Gateway runs cre simulate → settles on-chain
→ 200 { success, output, settlementTx }
```

**Environment variables:**
```bash
PLATFORM_WALLET=0x...           # receives x402 USDC payment
TREASURY_WALLET=0x...           # receives protocol fees
GATEWAY_PRIVATE_KEY=0x...       # signs CRE JWTs
SETTLEMENT_VAULT_ADDRESS=0x...
WORKFLOW_REGISTRY_ADDRESS=0x...
CRE_GATEWAY_URL=https://...
USDC_ADDRESS=0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238
SEPOLIA_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
PORT=8080
```

**Tests (50/50 passing):**
```bash
cd gateway && bun test
```

---

### Phase 3 — Smart Contracts (`contracts/`)

Foundry-based Solidity contracts on Ethereum Sepolia.

```
src/WorkflowRegistry.sol   — on-chain listing registry + execution history
src/SettlementVault.sol    — escrow hold → conditional fee split → settlement
src/interfaces/            — IERC20, IWorkflowRegistry
script/Deploy.s.sol        — deploy script (outputs addresses for .env)
test/WorkflowRegistry.t.sol — 11 tests
test/SettlementVault.t.sol  — 19 tests
```

**WorkflowRegistry.sol:**
- `listWorkflow(WorkflowMetadata)` — creator registers a workflow
- `getWorkflow(workflowId)` — returns full metadata
- `getWorkflowExecutions(workflowId, offset, limit)` — paginated history
- `recordExecution()` — called by SettlementVault after settlement

**SettlementVault.sol:**
- `createEscrow()` → emits `ExecutionTriggered`
- `settleSuccess()` → 90% creator / 10% treasury → emits `ExecutionSettled(success=true)`
- `settleFailure()` → 99% agent refund / 1% treasury → emits `ExecutionSettled(success=false)`

**Fee split:**

| Outcome | Creator | Protocol | Agent refund |
|---------|---------|----------|--------------|
| Success | 90% | 10% | 0% |
| Failure | 0% | 1% | 99% |

**Tests (30/30 passing):**
```bash
cd contracts && forge test --summary
```

**Deploy to Sepolia:**
```bash
cd contracts
forge script script/Deploy.s.sol --rpc-url $SEPOLIA_RPC_URL --private-key $DEPLOYER_KEY --broadcast
```

---

### Phase 4 — Marketplace Backend API (`backend/`)

REST API aggregating on-chain data, semantic search, and gateway proxy.

```
src/index.ts       — Express app factory + routes
src/cache.ts       — WorkflowCache (chain sync + demo seed fallback)
src/search.ts      — SearchIndex (sentence-transformers embeddings, cosine similarity)
src/registry.ts    — RegistryReader (viem, reads WorkflowRegistry.sol)
src/gateway.ts     — proxyTrigger (transparent x402 proxy)
src/types.ts       — WorkflowListing, WorkflowMetadata, toWorkflowResponse()
```

**API surface:**
```
GET  /api/workflows                   — list all active listings
GET  /api/workflows/search?q=<query>  — semantic search (top-K cosine similarity)
GET  /api/workflows/:workflowId       — workflow detail
POST /api/trigger/:workflowId         — proxy to x402 gateway
POST /api/workflows/list              — creator submits new listing
GET  /health                          — health check
```

**Demo mode:** When `WORKFLOW_REGISTRY_ADDRESS` is not set, serves 6 built-in demo listings (Aave health factor, Chainlink price feed, wallet monitor, proof of reserve, gas estimator, NFT floor price).

**Tests (37/37 passing):**
```bash
cd backend && bun test
```

**Environment variables:**
```bash
WORKFLOW_REGISTRY_ADDRESS=   # leave empty for demo mode
GATEWAY_URL=http://localhost:8080
PORT=4000
```

---

### Phase 5 — Marketplace Frontend (`frontend/`)

Next.js 14 App Router marketplace with Chainlink-aligned dark theme.

```
app/
  page.tsx                  — Landing page (animated network hero, featured workflows)
  browse/page.tsx           — Search + category filter + workflow grid
  workflow/[id]/page.tsx    — Workflow detail + sticky TriggerPanel
  list/page.tsx             — 4-step creator listing form
  crehub/openclaw/          — Openclaw agent skills pages
  sitemap.ts                — XML sitemap (all pages + raw .md files)
components/
  providers/Providers.tsx   — RainbowKit + Wagmi (ssr: false, SSR-safe)
  ui/Navbar.tsx             — Glassmorphism navbar + wallet connect
  ui/WorkflowCard.tsx       — Framer Motion cards with hover effects
  ui/Skeleton.tsx           — Shimmer skeleton loaders
  ui/SearchBar.tsx          — Glow-ring search with debounce
  workflow/TriggerPanel.tsx — 4-step x402 payment flow UI
  workflow/IOFieldList.tsx  — Input/output field type badges
  openclaw/MarkdownPage.tsx — Rendered markdown with frontmatter card
lib/
  api.ts                    — Typed API client + 6 demo workflow fallbacks
  types.ts                  — Workflow, SearchResult, formatPrice(), CATEGORY_COLORS
```

**Stack:** Next.js 14, Tailwind CSS, Framer Motion, RainbowKit v2, Wagmi v2, SWR, viem, `use-debounce`, `react-markdown`

**Theme:** Dark navy (`#0a0e1a`) + Chainlink blue (`#375BD2`) + glassmorphism cards, glow shadows, shimmer loaders

**Run:**
```bash
cd frontend && bun run dev   # http://localhost:3000
```

**Environment:**
```bash
NEXT_PUBLIC_BACKEND_URL=http://localhost:4000
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=your_project_id   # from cloud.walletconnect.com
```

---

### Phase 6 — Openclaw Agent Skills (`openclaw/`)

Separate git repository. An [Openclaw](https://agentskills.io/specification)-compatible SKILL.md that enables any AI agent to discover, pay for, and execute CRE workflows from the CREHub marketplace.

```
SKILL.md                          — Openclaw skill entry point
references/
  api.md                          — Full API surface + response shapes
  payment-flow.md                 — x402 step-by-step (402 → pay USDC → retry)
  workflow-schema.md              — Data types, price format, field definitions
examples/
  agent-demo.md                   — End-to-end agent walkthrough
```

**Discoverable via frontend (raw markdown + rendered HTML):**

| File | Raw URL | Rendered |
|------|---------|---------|
| SKILL.md | `/crehub/openclaw/SKILL.md` | `/crehub/openclaw` |
| api.md | `/crehub/openclaw/references/api.md` | `/crehub/openclaw/references/api` |
| payment-flow.md | `/crehub/openclaw/references/payment-flow.md` | `/crehub/openclaw/references/payment-flow` |
| workflow-schema.md | `/crehub/openclaw/references/workflow-schema.md` | `/crehub/openclaw/references/workflow-schema` |
| agent-demo.md | `/crehub/openclaw/examples/agent-demo.md` | `/crehub/openclaw/examples/agent-demo` |

**Agent flow:**
```
1. Openclaw reads SKILL.md at http://localhost:3000/crehub/openclaw/SKILL.md
2. Agent searches: GET /api/workflows/search?q=aave+health+factor
3. Agent triggers: POST /api/trigger/wf_hf_monitor_01
4. Gateway returns 402 → agent pays USDC → retries with X-Payment: <txHash>
5. Returns { success: true, output: { healthFactor: 2.4, riskLevel: "safe" }, settlementTx }
```

---

## Demo Workflows (built-in)

| Workflow ID | Category | Price | Description |
|-------------|----------|-------|-------------|
| `wf_hf_monitor_01` | DeFi | $0.01 | Aave v3 health factor for a lending position |
| `wf_price_feed_01` | Data | $0.005 | Chainlink price feed (any pair) |
| `wf_wallet_monitor_01` | Monitoring | $0.008 | ETH balance monitor with alert threshold |
| `wf_proof_of_reserve_01` | DeFi | $0.015 | Chainlink Proof of Reserve verifier |
| `wf_gas_estimator_01` | Compute | $0.003 | Gas price tiers via Chainlink Fast Gas feed |
| `wf_nft_floor_01` | Data | $0.006 | NFT collection floor price via Chainlink feeds |

---

## Running Tests

```bash
# Gateway (50 tests)
bun run test:gateway

# Backend (37 tests)
bun run test:backend

# Contracts (30 tests)
bun run test:contracts

# All
bun test
```

---

## Key Technical Decisions

| Decision | Choice | Rationale |
|---------|--------|-----------|
| Payment network | Ethereum Sepolia (chainId 11155111) | Matches CRE staging config |
| x402 verifier | Manual viem verifier | x402 SDK only covers Base/Base-Sepolia natively |
| USDC contract | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` | Circle official USDC on Sepolia |
| Demo execution | `cre workflow simulate` | No DON deployment needed for demo |
| JWT auth for CRE | ETH-signed JWT (ECDSA/secp256k1) | CRE gateway requires this format |
| Fee split (success) | 90% creator / 10% protocol | Rewards creators, sustains protocol |
| Fee split (failure) | 99% agent refund / 1% ops | Protects agents from bad workflows |
| Agent interface | SKILL.md (agentskills.io spec) | Openclaw-native discovery + trigger |
| Workflow lock | `AuthorizedKey = CREHUB_GATEWAY_PUBKEY` | Only CREHub gateway can fire workflows |
| Compiler | `via_ir = true` (Foundry) | Fixes stack-too-deep for large structs |
| Frontend SSR | `ssr: false` for wallet providers | WalletConnect uses `indexedDB` (browser-only) |

---

## Network / Contract Addresses

| Item | Address |
|------|---------|
| USDC (Sepolia) | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |
| WorkflowRegistry | deploy via `contracts/script/Deploy.s.sol` |
| SettlementVault | deploy via `contracts/script/Deploy.s.sol` |
| RPC (Sepolia) | `https://ethereum-sepolia-rpc.publicnode.com` |

---

## License

MIT
