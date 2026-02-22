/**
 * CREHub x402 Payment Gateway
 *
 * Routes:
 *   GET  /health                    → health check
 *   GET  /workflows                 → list workflows from MongoDB (or in-memory in tests)
 *   POST /trigger/:workflowId       → x402-gated workflow execution
 *
 * Startup sequence (production):
 *   1. connectDb()   — connect to the shared MongoDB instance
 *   2. app.listen()
 *
 * Workflows are written to MongoDB by the backend's event listener when
 * WorkflowListed events are emitted on-chain. The gateway is read-only.
 *
 * In tests: call registerWorkflow() to seed the in-memory registry,
 * which is used when _useDb = false (the default).
 */
import express, { type Request, type Response } from 'express'
import { createPaymentMiddleware, holdAndExecute, type PaymentVerifiedRequest } from './payment'
import { LoggingSettlementClient } from './settlement'
import type { WorkflowMetadata } from './types'

// ─── Default workflow directory ───────────────────────────────────────────────
// All workflows share this directory for `cre simulate` unless overridden per-doc.

const WORKFLOW_DIR = () =>
	process.env.WORKFLOW_DIR ??
	new URL('../../cre-workflow-template', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')

// ─── In-memory registry (used in tests and as fallback) ───────────────────────

const _registry = new Map<string, WorkflowMetadata>()
let _useDb = false

/** Register a workflow in the in-memory registry (test helper). */
export const registerWorkflow = (metadata: WorkflowMetadata): void => {
	_registry.set(metadata.workflowId, metadata)
}

// ─── Lookup helpers ───────────────────────────────────────────────────────────

const findWorkflow = async (workflowId: string): Promise<WorkflowMetadata | null> => {
	if (_useDb) {
		const { getOne } = await import('./db')
		return getOne(workflowId, WORKFLOW_DIR())
	}
	return _registry.get(workflowId) ?? null
}

const listWorkflows = async (): Promise<WorkflowMetadata[]> => {
	if (_useDb) {
		const { getAllActive } = await import('./db')
		return getAllActive(WORKFLOW_DIR())
	}
	return [..._registry.values()]
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
		const workflows = await listWorkflows()
		// Strip workflowDir — it is a server-side field, not exposed to callers
		res.json(workflows.map(({ workflowDir: _, ...rest }) => rest))
	})

	// ── Trigger workflow ──────────────────────────────────────────────────────
	app.post(
		'/trigger/:workflowId',
		createPaymentMiddleware(getWorkflowPrice),
		async (req: PaymentVerifiedRequest, res: Response) => {
			const { workflowId } = req.params

			const metadata = await findWorkflow(workflowId)
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
		_useDb = true

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
