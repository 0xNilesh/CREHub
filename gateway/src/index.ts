/**
 * CREHub x402 Payment Gateway
 *
 * Routes:
 *   GET  /health                    → health check
 *   GET  /workflows                 → list registered workflows (in-memory for demo)
 *   POST /trigger/:workflowId       → x402-gated workflow execution
 *
 * Payment flow (Ethereum Sepolia):
 *   1. No X-PAYMENT header → 402 + paymentDetails
 *   2. X-PAYMENT: <txHash> → verify USDC Transfer → 200 + { success, output, settlementTx }
 */
import express, { type Request, type Response } from 'express'
import { z } from 'zod'
import { createPaymentMiddleware, holdAndExecute, type PaymentVerifiedRequest } from './payment'
import { LoggingSettlementClient } from './settlement'
import type { WorkflowMetadata } from './types'
import type { Hex } from 'viem'

// ─── In-memory workflow registry (demo) ──────────────────────────────────────
// In production this reads from WorkflowRegistry.sol via viem.

const workflowRegistry = new Map<string, WorkflowMetadata>()

export const registerWorkflow = (metadata: WorkflowMetadata) => {
	workflowRegistry.set(metadata.workflowId, metadata)
}

const getWorkflowPrice = (workflowId: string): bigint => {
	const wf = workflowRegistry.get(workflowId)
	if (!wf) return 0n
	return BigInt(wf.pricePerInvocation)
}

// ─── Settlement client ────────────────────────────────────────────────────────

const settlement = new LoggingSettlementClient()

// ─── App ──────────────────────────────────────────────────────────────────────

export const createApp = () => {
	const app = express()
	app.use(express.json())

	// ── Health check ──────────────────────────────────────────────────────────
	app.get('/health', (_req: Request, res: Response) => {
		res.json({ status: 'ok', timestamp: new Date().toISOString() })
	})

	// ── List workflows ────────────────────────────────────────────────────────
	app.get('/workflows', (_req: Request, res: Response) => {
		const workflows = [...workflowRegistry.values()].map(({ workflowDir: _, ...rest }) => rest)
		res.json(workflows)
	})

	// ── Trigger workflow ──────────────────────────────────────────────────────
	app.post(
		'/trigger/:workflowId',
		createPaymentMiddleware(getWorkflowPrice),
		async (req: PaymentVerifiedRequest, res: Response) => {
			const { workflowId } = req.params

			const metadata = workflowRegistry.get(workflowId)
			if (!metadata) {
				return res.status(404).json({ error: `Workflow '${workflowId}' not found` })
			}

			if (!metadata.active) {
				return res.status(410).json({ error: `Workflow '${workflowId}' is not active` })
			}

			const input = req.body

			try {
				const result = await holdAndExecute({
					workflowId,
					workflowDir: metadata.workflowDir,
					agentAddress: req.agentAddress!,
					creatorAddress: metadata.creatorAddress,
					amount: req.workflowPrice!,
					input,
					settlement,
				})

				return res.status(200).json(result)
			} catch (err) {
				const msg = err instanceof Error ? err.message : 'Internal error'
				console.error(`[trigger] ${workflowId}: ${msg}`)
				return res.status(500).json({ error: msg })
			}
		},
	)

	return app
}

// ─── Demo workflow seed ───────────────────────────────────────────────────────
// All demo workflows share the cre-workflow-template dir for `cre simulate`.
// Set WORKFLOW_DIR in .env to override (e.g. absolute path on the server).

const WORKFLOW_DIR =
	process.env.WORKFLOW_DIR ?? new URL('../../cre-workflow-template', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')

const DEMO_WORKFLOWS: Omit<WorkflowMetadata, 'workflowDir'>[] = [
	{
		workflowId: 'wf_hf_monitor_01',
		creatorAddress: '0xf39Fd6e51aad88F6f4ce6aB8827279cffFb92266' as Hex,
		pricePerInvocation: '10000',
		description: 'Returns the health factor for an Aave v3 lending position.',
		detailedDescription: 'Given a wallet address, queries Aave v3 and returns health factor and risk level.',
		category: 'defi',
		active: true,
		inputs:  [{ name: 'walletAddress', type: 'address', description: 'Position owner', required: true }],
		outputs: [{ name: 'healthFactor', type: 'number', description: 'Ratio ≥ 1 is safe', required: true }],
	},
	{
		workflowId: 'wf_price_feed_01',
		creatorAddress: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Hex,
		pricePerInvocation: '5000',
		description: 'Fetches the latest Chainlink price feed value for any asset pair.',
		detailedDescription: 'Reads a Chainlink Data Feed and returns latest answer, decimals, and round ID.',
		category: 'data',
		active: true,
		inputs:  [{ name: 'feedAddress', type: 'address', description: 'Chainlink feed contract', required: true }],
		outputs: [{ name: 'price', type: 'number', description: 'Latest answer', required: true }],
	},
	{
		workflowId: 'wf_wallet_monitor_01',
		creatorAddress: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as Hex,
		pricePerInvocation: '8000',
		description: 'Monitors a wallet for low ETH balance and triggers an alert.',
		detailedDescription: 'Checks native ETH balance and compares to a threshold. Returns balance and alert flag.',
		category: 'monitoring',
		active: true,
		inputs:  [{ name: 'walletAddress', type: 'address', description: 'Wallet to monitor', required: true }],
		outputs: [{ name: 'balanceEth', type: 'number', description: 'Current ETH balance', required: true }],
	},
	{
		workflowId: 'wf_proof_of_reserve_01',
		creatorAddress: '0x90F79bf6EB2c4f870365E785982E1f101E93b906' as Hex,
		pricePerInvocation: '15000',
		description: 'Verifies on-chain Proof of Reserve for any Chainlink PoR feed.',
		detailedDescription: 'Queries a Chainlink Proof of Reserve feed and validates minimum reserve ratio.',
		category: 'defi',
		active: true,
		inputs:  [{ name: 'porFeedAddress', type: 'address', description: 'Chainlink PoR feed', required: true }],
		outputs: [{ name: 'isAdequate', type: 'boolean', description: 'True if reserve ratio is met', required: true }],
	},
	{
		workflowId: 'wf_gas_estimator_01',
		creatorAddress: '0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65' as Hex,
		pricePerInvocation: '3000',
		description: 'Estimates optimal gas price using Chainlink Fast Gas feed.',
		detailedDescription: 'Reads Chainlink Fast Gas feed and returns safe-low, standard, and fast gas tiers.',
		category: 'compute',
		active: true,
		inputs:  [{ name: 'network', type: 'string', description: "'mainnet' | 'sepolia'", required: false }],
		outputs: [{ name: 'standardGwei', type: 'number', description: 'Standard gas price in Gwei', required: true }],
	},
	{
		workflowId: 'wf_nft_floor_01',
		creatorAddress: '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc' as Hex,
		pricePerInvocation: '6000',
		description: 'Fetches NFT collection floor price from Chainlink NFT Floor Price Feeds.',
		detailedDescription: 'Uses Chainlink NFT Floor Price Feeds to return floor price and 24h change.',
		category: 'data',
		active: true,
		inputs:  [{ name: 'floorFeedAddress', type: 'address', description: 'Chainlink NFT floor feed', required: true }],
		outputs: [{ name: 'floorPriceEth', type: 'number', description: 'Floor price in ETH', required: true }],
	},
]

// ─── Start ────────────────────────────────────────────────────────────────────

if (process.env.NODE_ENV !== 'test') {
	const port = Number(process.env.PORT ?? 8080)

	// Seed demo workflows into the in-memory registry
	for (const wf of DEMO_WORKFLOWS) {
		registerWorkflow({ ...wf, workflowDir: WORKFLOW_DIR })
	}
	console.log(`[gateway] Seeded ${DEMO_WORKFLOWS.length} demo workflows (dir: ${WORKFLOW_DIR})`)

	const app = createApp()
	app.listen(port, () => {
		console.log(`CREHub Gateway running on http://localhost:${port}`)
		console.log('Routes:')
		console.log('  GET  /health')
		console.log('  GET  /workflows')
		console.log('  POST /trigger/:workflowId')
	})
}
