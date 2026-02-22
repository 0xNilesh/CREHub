/**
 * CREHub x402 Payment Gateway
 *
 * Routes:
 *   GET  /health                    → health check
 *   GET  /workflows                 → list workflows from MongoDB
 *   POST /trigger/:workflowId       → x402-gated workflow execution
 *
 * All workflow lookups go directly to MongoDB — no in-memory registry.
 *
 * Startup sequence:
 *   1. connectDb() — connect to the shared MongoDB instance
 *   2. app.listen()
 *
 * In tests: mock the db module to provide workflow data without MongoDB.
 */
import express, { type Request, type Response } from 'express'
import { createPaymentMiddleware, holdAndExecute, type PaymentVerifiedRequest } from './payment'
import { LoggingSettlementClient } from './settlement'
import type { WorkflowMetadata } from './types'

// ─── Default workflow directory ───────────────────────────────────────────────

const WORKFLOW_DIR = () =>
	process.env.WORKFLOW_DIR ??
	new URL('../../cre-workflow-template', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')

// ─── Lookup helpers (always MongoDB) ─────────────────────────────────────────

const findWorkflow = async (workflowId: string): Promise<WorkflowMetadata | null> => {
	const { getOne } = await import('./db')
	return getOne(workflowId, WORKFLOW_DIR())
}

const listWorkflows = async (): Promise<WorkflowMetadata[]> => {
	const { getAllActive } = await import('./db')
	return getAllActive(WORKFLOW_DIR())
}

const getWorkflowPrice = async (workflowId: string): Promise<bigint> => {
	const wf = await findWorkflow(workflowId)
	if (!wf) return 0n
	return BigInt(wf.pricePerInvocation)
}

// ─── Settlement client ────────────────────────────────────────────────────────

const settlement = new LoggingSettlementClient()

// ─── App ──────────────────────────────────────────────────────────────────────

export const createApp = () => {
	const app = express()
	app.use(express.json())

	// ── Health ────────────────────────────────────────────────────────────────
	app.get('/health', (_req: Request, res: Response) => {
		res.json({ status: 'ok', timestamp: new Date().toISOString() })
	})

	// ── List workflows ────────────────────────────────────────────────────────
	app.get('/workflows', async (_req: Request, res: Response) => {
		try {
			const workflows = await listWorkflows()
			// Strip workflowDir — server-side field, not exposed to callers
			res.json(workflows.map(({ workflowDir: _, ...rest }) => rest))
		} catch (err) {
			res.status(503).json({ error: 'Database unavailable' })
		}
	})

	// ── Trigger workflow ──────────────────────────────────────────────────────
	app.post(
		'/trigger/:workflowId',
		createPaymentMiddleware(getWorkflowPrice),
		async (req: PaymentVerifiedRequest, res: Response) => {
			const { workflowId } = req.params

			let metadata: WorkflowMetadata | null
			try {
				metadata = await findWorkflow(workflowId)
			} catch {
				return res.status(503).json({ error: 'Database unavailable' })
			}

			if (!metadata) {
				return res.status(404).json({ error: `Workflow '${workflowId}' not found` })
			}

			if (!metadata.active) {
				return res.status(410).json({ error: `Workflow '${workflowId}' is not active` })
			}

			try {
				const result = await holdAndExecute({
					workflowId,
					workflowDir: metadata.workflowDir,
					agentAddress: req.agentAddress!,
					creatorAddress: metadata.creatorAddress,
					amount: req.workflowPrice!,
					input: req.body,
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

	const start = async () => {
		const { connectDb } = await import('./db')
		await connectDb()

		const app = createApp()
		app.listen(port, () => {
			console.log(`CREHub Gateway running on http://localhost:${port}`)
			console.log('Routes:')
			console.log('  GET  /health')
			console.log('  GET  /workflows')
			console.log('  POST /trigger/:workflowId')
		})
	}

	start().catch((err) => {
		console.error('Fatal startup error:', err)
		process.exit(1)
	})
}
