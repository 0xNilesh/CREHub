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

// ─── Start ────────────────────────────────────────────────────────────────────

if (process.env.NODE_ENV !== 'test') {
	const port = Number(process.env.PORT ?? 8080)
	const app = createApp()
	app.listen(port, () => {
		console.log(`CREHub Gateway running on http://localhost:${port}`)
		console.log('Routes:')
		console.log('  GET  /health')
		console.log('  GET  /workflows')
		console.log('  POST /trigger/:workflowId')
	})
}
