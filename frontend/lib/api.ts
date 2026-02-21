import type { Workflow, SearchResult } from './types'

const BASE = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:4000'

// ─── Demo fallback ────────────────────────────────────────────────────────────
// Shown when the backend is not running (dev without backend started).

const DEMO_WORKFLOWS: Workflow[] = [
  {
    workflowId: 'wf_hf_monitor_01',
    creatorAddress: '0xf39Fd6e51aad88F6f4ce6aB8827279cffFb92266',
    pricePerInvocation: '10000',
    description: 'Returns the health factor for an Aave v3 lending position.',
    detailedDescription:
      'Given a wallet address, queries Aave v3 on Ethereum mainnet and returns the health factor (≥ 1 is safe) and risk level (safe / warning / danger). Useful for liquidation bots and portfolio dashboards.',
    category: 'defi',
    active: true,
    registeredAt: '0',
    inputs: [
      { name: 'walletAddress', fieldType: 'address', description: 'Position owner', required: true },
      { name: 'protocol', fieldType: 'string', description: "'aave' | 'compound'", required: false },
    ],
    outputs: [
      { name: 'healthFactor', fieldType: 'number', description: 'Ratio ≥ 1 is safe', required: true },
      { name: 'riskLevel', fieldType: 'string', description: "'safe' | 'warning' | 'danger'", required: true },
    ],
  },
  {
    workflowId: 'wf_price_feed_01',
    creatorAddress: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8',
    pricePerInvocation: '5000',
    description: 'Fetches the latest Chainlink price feed value for any asset pair.',
    detailedDescription:
      'Reads a Chainlink Data Feed contract and returns the latest answer, decimals, and round ID. Supports any pair with a deployed feed on Ethereum mainnet. Perfect for on-chain price oracles.',
    category: 'data',
    active: true,
    registeredAt: '0',
    inputs: [
      { name: 'feedAddress', fieldType: 'address', description: 'Chainlink feed contract address', required: true },
    ],
    outputs: [
      { name: 'price', fieldType: 'number', description: 'Latest answer', required: true },
      { name: 'decimals', fieldType: 'number', description: 'Feed decimal precision', required: true },
      { name: 'roundId', fieldType: 'string', description: 'Round ID', required: true },
    ],
  },
  {
    workflowId: 'wf_wallet_monitor_01',
    creatorAddress: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    pricePerInvocation: '8000',
    description: 'Monitors a wallet for low ETH balance and triggers an alert.',
    detailedDescription:
      'Checks the native ETH balance of a wallet address and compares it to a configurable threshold. Returns current balance and a boolean alert flag. Useful for automated top-up bots and treasury watchers.',
    category: 'monitoring',
    active: true,
    registeredAt: '0',
    inputs: [
      { name: 'walletAddress', fieldType: 'address', description: 'Wallet to monitor', required: true },
      { name: 'thresholdEth', fieldType: 'number', description: 'Alert below this ETH balance', required: false },
    ],
    outputs: [
      { name: 'balanceEth', fieldType: 'number', description: 'Current ETH balance', required: true },
      { name: 'belowThreshold', fieldType: 'boolean', description: 'True if alert triggered', required: true },
    ],
  },
  {
    workflowId: 'wf_proof_of_reserve_01',
    creatorAddress: '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
    pricePerInvocation: '15000',
    description: 'Verifies on-chain Proof of Reserve for any Chainlink PoR feed.',
    detailedDescription:
      'Queries a Chainlink Proof of Reserve feed and validates that the reported off-chain reserve meets the minimum required ratio. Returns reserve amount, total supply, and whether the reserve is adequate.',
    category: 'defi',
    active: true,
    registeredAt: '0',
    inputs: [
      { name: 'porFeedAddress', fieldType: 'address', description: 'Chainlink PoR feed contract', required: true },
      { name: 'minRatioBps', fieldType: 'number', description: 'Minimum reserve ratio in basis points (e.g. 10000 = 100%)', required: false },
    ],
    outputs: [
      { name: 'reserveAmount', fieldType: 'string', description: 'Off-chain reserves in wei', required: true },
      { name: 'totalSupply', fieldType: 'string', description: 'On-chain token supply in wei', required: true },
      { name: 'isAdequate', fieldType: 'boolean', description: 'True if reserve ratio is met', required: true },
    ],
  },
  {
    workflowId: 'wf_gas_estimator_01',
    creatorAddress: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65',
    pricePerInvocation: '3000',
    description: 'Estimates optimal gas price using Chainlink Fast Gas feed.',
    detailedDescription:
      'Reads the Chainlink Fast Gas / Gwei feed and returns safe-low, standard, and fast gas price tiers. Helps AI agents pick the right gas price before broadcasting transactions.',
    category: 'compute',
    active: true,
    registeredAt: '0',
    inputs: [
      { name: 'network', fieldType: 'string', description: "'mainnet' | 'sepolia'", required: false },
    ],
    outputs: [
      { name: 'safeLowGwei', fieldType: 'number', description: 'Economy gas price in Gwei', required: true },
      { name: 'standardGwei', fieldType: 'number', description: 'Standard gas price in Gwei', required: true },
      { name: 'fastGwei', fieldType: 'number', description: 'Fast gas price in Gwei', required: true },
      { name: 'baseFeeGwei', fieldType: 'number', description: 'Current base fee in Gwei', required: true },
    ],
  },
  {
    workflowId: 'wf_nft_floor_01',
    creatorAddress: '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc',
    pricePerInvocation: '6000',
    description: 'Fetches NFT collection floor price from on-chain Chainlink feeds.',
    detailedDescription:
      'Uses Chainlink NFT Floor Price Feeds to return the current floor price and 24h change for a given collection. Eliminates reliance on centralised APIs for NFT pricing in DeFi protocols.',
    category: 'data',
    active: true,
    registeredAt: '0',
    inputs: [
      { name: 'floorFeedAddress', fieldType: 'address', description: 'Chainlink NFT floor price feed', required: true },
    ],
    outputs: [
      { name: 'floorPriceEth', fieldType: 'number', description: 'Floor price in ETH', required: true },
      { name: 'change24hPct', fieldType: 'number', description: '24-hour price change %', required: true },
      { name: 'updatedAt', fieldType: 'string', description: 'ISO timestamp of last update', required: true },
    ],
  },
]

// ─── HTTP helper ──────────────────────────────────────────────────────────────

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

// Simple keyword search over demo data (used when backend is offline)
function searchDemo(q: string, limit: number): SearchResult[] {
  const terms = q.toLowerCase().split(/\s+/)
  return DEMO_WORKFLOWS
    .map((wf) => {
      const text = `${wf.workflowId} ${wf.description} ${wf.detailedDescription} ${wf.category}`.toLowerCase()
      const score = terms.reduce((acc, t) => acc + (text.includes(t) ? 1 : 0), 0) / terms.length
      return { ...wf, score }
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

// ─── API ──────────────────────────────────────────────────────────────────────

export const api = {
  listWorkflows: () =>
    req<Workflow[]>('/api/workflows').catch(() => DEMO_WORKFLOWS),

  searchWorkflows: (q: string, limit = 10) =>
    req<SearchResult[]>(`/api/workflows/search?q=${encodeURIComponent(q)}&limit=${limit}`)
      .catch(() => searchDemo(q, limit)),

  getWorkflow: (id: string) =>
    req<Workflow>(`/api/workflows/${id}`)
      .catch(() => {
        const wf = DEMO_WORKFLOWS.find((w) => w.workflowId === id)
        if (!wf) throw new Error(`Workflow '${id}' not found`)
        return wf
      }),

  listWorkflow: (data: unknown) =>
    req<{ message: string; workflow: Workflow }>('/api/workflows/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

  trigger: async (
    workflowId: string,
    input: unknown,
    txHash?: string,
  ): Promise<{ status: number; body: unknown }> => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (txHash) headers['x-payment'] = txHash

    const res = await fetch(`${BASE}/api/trigger/${workflowId}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
    })
    const body = await res.json()
    return { status: res.status, body }
  },
}
