#!/usr/bin/env bun
/**
 * Registers wf_ta_signal_01 on WorkflowRegistry (Sepolia).
 *
 * Usage:
 *   bun scripts/register-ta-signal.ts
 *
 * Requires env vars (reads gateway/.env automatically):
 *   WORKFLOW_REGISTRY_ADDRESS
 *   GATEWAY_PRIVATE_KEY
 *   SEPOLIA_RPC_URL
 */

import { createWalletClient, createPublicClient, http, parseAbi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// ── Load gateway .env ─────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = join(__dirname, '../gateway/.env')
const envText = readFileSync(envPath, 'utf8')
for (const line of envText.split('\n')) {
	const trimmed = line.trim()
	if (!trimmed || trimmed.startsWith('#')) continue
	const eq = trimmed.indexOf('=')
	if (eq === -1) continue
	const key = trimmed.slice(0, eq).trim()
	const val = trimmed.slice(eq + 1).trim()
	if (!process.env[key]) process.env[key] = val
}

const REGISTRY_ADDRESS = process.env.WORKFLOW_REGISTRY_ADDRESS as `0x${string}`
const PRIVATE_KEY      = process.env.GATEWAY_PRIVATE_KEY as `0x${string}`
const RPC_URL          = process.env.SEPOLIA_RPC_URL!

if (!REGISTRY_ADDRESS || !PRIVATE_KEY || !RPC_URL) {
	console.error('Missing WORKFLOW_REGISTRY_ADDRESS, GATEWAY_PRIVATE_KEY or SEPOLIA_RPC_URL')
	process.exit(1)
}

// ── ABI (only what we need) ───────────────────────────────────────────────────
const REGISTRY_ABI = parseAbi([
	'function listWorkflow(string workflowId, uint256 price, string description, string detailedDescription, string category, (string name, string fieldType, string description, bool required)[] inputs, (string name, string fieldType, string description, bool required)[] outputs) external',
	'function workflowExists(string workflowId) view returns (bool)',
])

// ── Workflow definition ───────────────────────────────────────────────────────
const WORKFLOW_ID = 'wf_ta_signal_01'
const PRICE       = 100_000n  // 0.1 USDC (6 decimals)

const INPUTS = [
	{ name: 'symbol',   fieldType: 'string', description: "Trading pair, e.g. 'BTC/USDT'. Defaults to 'BTC/USDT'.", required: false },
	{ name: 'exchange', fieldType: 'string', description: "Exchange identifier (e.g. 'binance'). Defaults to 'binance'.", required: false },
	{ name: 'interval', fieldType: 'string', description: "Candle interval: 1m|5m|15m|30m|1h|2h|4h|12h|1d|1w. Defaults to '1h'.", required: false },
] as const

const OUTPUTS = [
	{ name: 'decision',   fieldType: 'string', description: "Trading signal: 'BUY', 'SELL', or 'HOLD'.", required: true },
	{ name: 'confidence', fieldType: 'number', description: 'Model confidence score between 0 and 1.', required: true },
	{ name: 'reason',     fieldType: 'string', description: 'One-sentence explanation of the decision.', required: true },
	{ name: 'indicators', fieldType: 'string', description: 'JSON object with raw indicator values (rsi, macd, bbands, price).', required: true },
	{ name: 'symbol',     fieldType: 'string', description: 'The trading pair that was analysed.', required: true },
	{ name: 'interval',   fieldType: 'string', description: 'The candle interval that was used.', required: true },
	{ name: 'timestamp',  fieldType: 'string', description: 'ISO-8601 timestamp of when the analysis was run.', required: true },
] as const

const DESCRIPTION = 'AI-powered TA signal: BUY / SELL / HOLD for any crypto pair via TAAPI + GPT-4o-mini.'
const DETAILED    = 'Fetches real-time RSI, MACD, and Bollinger Band data from TAAPI.io for the requested symbol and timeframe, then passes the indicators to OpenAI gpt-4o-mini which returns a structured BUY / SELL / HOLD decision with a confidence score and plain-English reasoning.'
const CATEGORY    = 'ai'

// ── Clients ───────────────────────────────────────────────────────────────────
const account = privateKeyToAccount(PRIVATE_KEY)
const publicClient = createPublicClient({ chain: sepolia, transport: http(RPC_URL) })
const walletClient = createWalletClient({ account, chain: sepolia, transport: http(RPC_URL) })

console.log(`Registering ${WORKFLOW_ID} on WorkflowRegistry at ${REGISTRY_ADDRESS}`)
console.log(`Caller: ${account.address}`)

// ── Check if already registered ───────────────────────────────────────────────
const exists = await publicClient.readContract({
	address: REGISTRY_ADDRESS,
	abi: REGISTRY_ABI,
	functionName: 'workflowExists',
	args: [WORKFLOW_ID],
}).catch(() => false)

if (exists) {
	console.log(`\n✓ ${WORKFLOW_ID} is already registered on-chain. Nothing to do.`)
	process.exit(0)
}

// ── Send transaction ──────────────────────────────────────────────────────────
const hash = await walletClient.writeContract({
	address: REGISTRY_ADDRESS,
	abi: REGISTRY_ABI,
	functionName: 'listWorkflow',
	args: [
		WORKFLOW_ID,
		PRICE,
		DESCRIPTION,
		DETAILED,
		CATEGORY,
		INPUTS as any,
		OUTPUTS as any,
	],
})

console.log(`\nTx submitted: ${hash}`)
console.log('Waiting for confirmation...')

const receipt = await publicClient.waitForTransactionReceipt({ hash })
console.log(`\n✓ ${WORKFLOW_ID} registered!`)
console.log(`  Block:  ${receipt.blockNumber}`)
console.log(`  Status: ${receipt.status}`)
console.log(`  Tx:     https://sepolia.etherscan.io/tx/${hash}`)
