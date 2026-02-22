export interface WorkflowIOField {
  name: string
  fieldType: 'string' | 'number' | 'boolean' | 'address'
  description: string
  required: boolean
}

export interface Workflow {
  workflowId: string
  creatorAddress: string
  pricePerInvocation: string  // USDC wei as string
  description: string
  detailedDescription: string
  category: 'defi' | 'monitoring' | 'data' | 'compute'
  active: boolean
  registeredAt: string
  inputs: WorkflowIOField[]
  outputs: WorkflowIOField[]
}

export interface SearchResult extends Workflow {
  score: number
}

export type Category = 'all' | Workflow['category']

export const CATEGORY_LABELS: Record<string, string> = {
  all:        'All',
  defi:       'DeFi',
  monitoring: 'Monitoring',
  data:       'Data',
  compute:    'Compute',
}

export const CATEGORY_COLORS: Record<string, string> = {
  defi:       'bg-blue-500/15 text-blue-300 border-blue-500/25',
  monitoring: 'bg-amber-500/15 text-amber-300 border-amber-500/25',
  data:       'bg-emerald-500/15 text-emerald-300 border-emerald-500/25',
  compute:    'bg-purple-500/15 text-purple-300 border-purple-500/25',
}

/** Format USDC wei (6 decimals) to readable string e.g. "$0.01" */
export const formatPrice = (wei: string): string => {
  const n = Number(wei)
  if (isNaN(n)) return '$?'
  const usd = n / 1_000_000
  if (usd === 0) return 'Free'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(usd % 1 === 0 ? 0 : 2)}`
}

/** Shorten an EVM address: 0x1234…abcd */
export const shortAddr = (addr: string): string =>
  addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : ''

/** Shorten a tx/execution hash */
export const shortHash = (hash: string): string =>
  hash ? `${hash.slice(0, 10)}…${hash.slice(-6)}` : '—'

export const SEPOLIA_EXPLORER = 'https://sepolia.etherscan.io'

// ─── Execution (explorer / dashboard) ────────────────────────────────────────

export interface Execution {
  executionId:      string
  workflowId:       string
  agentAddress:     string
  creatorAddress:   string
  amount:           string
  inputsJson:       string
  outputsJson:      string
  errorMessage:     string
  status:           'pending' | 'success' | 'failure'
  paymentTxHash:    string
  settlementTxHash: string
  triggeredAt:      string
  settledAt:        string | null
}

export interface ExecutionsPage {
  items: Execution[]
  total: number
}

export const formatUSDC = (wei: string): string => {
  const n = Number(wei)
  if (isNaN(n) || n === 0) return '$0'
  return `$${(n / 1_000_000).toFixed(4)}`
}
