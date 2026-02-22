/**
 * CREHub Marketplace Backend API
 *
 * Routes:
 *   GET  /api/workflows                  → list all active listings from MongoDB
 *   GET  /api/workflows/search?q=<query> → semantic search
 *   GET  /api/workflows/:workflowId      → workflow detail
 *   POST /api/trigger/:workflowId        → proxy to x402 gateway
 *
 * Startup sequence:
 *   1. connectDb()                        — connect to MongoDB (fatal if fails)
 *   2. bootstrap(registryAddress, index)  — sync existing on-chain workflows into MongoDB
 *   3. startListener(registryAddress, index) — watch WorkflowListed / WorkflowUpdated events
 *   4. app.listen()
 *
 * All reads go directly to MongoDB — no in-memory cache.
 */
import express, { type Request, type Response } from 'express'
import cors from 'cors'
import { getAllActive, getOne, getExecutions, getExecutionById } from './db'
import { SearchIndex, buildSearchText } from './search'
import { RegistryReader } from './registry'
import { proxyTrigger } from './gateway'
import { toWorkflowResponse } from './types'

// ─── Module-level search index ────────────────────────────────────────────────
// Rebuilt by listener.ts on every WorkflowListed / WorkflowUpdated event.
// Exported so tests can seed it without MongoDB.

export const searchIndex = new SearchIndex()

// ─── App factory ──────────────────────────────────────────────────────────────

export const createApp = () => {
	const app = express()
	app.use(cors())
	app.use(express.json())

	// ── Health ─────────────────────────────────────────────────────────────────
	app.get('/health', (_req: Request, res: Response) => {
		res.json({ status: 'ok', timestamp: new Date().toISOString() })
	})

	// ── List all workflows ─────────────────────────────────────────────────────
	app.get('/api/workflows', async (_req: Request, res: Response) => {
		try {
			const listings = await getAllActive()
			res.json(listings.map(toWorkflowResponse))
		} catch (err) {
			res.status(503).json({ error: 'Database unavailable' })
		}
	})

	// ── Semantic search ────────────────────────────────────────────────────────
	// Must be registered BEFORE /api/workflows/:workflowId to avoid path collision.
	app.get('/api/workflows/search', async (req: Request, res: Response) => {
		const q = req.query.q as string | undefined
		if (!q || q.trim().length === 0) {
			return res.status(400).json({ error: 'Query parameter "q" is required' })
		}

		const topK = Math.min(Number(req.query.limit ?? 5), 20)

		try {
			const hits = await searchIndex.query(q.trim(), topK)
			const results = (
				await Promise.all(
					hits.map(async (hit) => {
						const listing = await getOne(hit.id)
						if (!listing) return null
						return { ...toWorkflowResponse(listing), score: hit.score }
					}),
				)
			).filter(Boolean)
			res.json(results)
		} catch (err) {
			res.status(503).json({ error: 'Database unavailable' })
		}
	})

	// ── Workflow detail ────────────────────────────────────────────────────────
	app.get('/api/workflows/:workflowId', async (req: Request, res: Response) => {
		try {
			const listing = await getOne(req.params.workflowId)
			if (!listing) return res.status(404).json({ error: `Workflow '${req.params.workflowId}' not found` })
			res.json(toWorkflowResponse(listing))
		} catch (err) {
			res.status(503).json({ error: 'Database unavailable' })
		}
	})

	// ── Trigger proxy ──────────────────────────────────────────────────────────
	app.post('/api/trigger/:workflowId', proxyTrigger)

	// ── Explorer: all executions (paginated, filterable) ───────────────────────
	// GET /api/executions?page=1&limit=20&workflowId=wf_xxx&agentAddress=0x...
	app.get('/api/executions', async (req: Request, res: Response) => {
		try {
			const page    = Math.max(1, Number(req.query.page  ?? 1))
			const limit   = Math.min(50, Math.max(1, Number(req.query.limit ?? 20)))
			const workflowId   = req.query.workflowId   as string | undefined
			const agentAddress = req.query.agentAddress as string | undefined
			const result = await getExecutions({ page, limit, workflowId, agentAddress })
			res.json(result)
		} catch {
			res.status(503).json({ error: 'Database unavailable' })
		}
	})

	// ── Explorer: single execution detail ─────────────────────────────────────
	app.get('/api/executions/:executionId', async (req: Request, res: Response) => {
		try {
			const doc = await getExecutionById(req.params.executionId)
			if (!doc) return res.status(404).json({ error: 'Execution not found' })
			res.json(doc)
		} catch {
			res.status(503).json({ error: 'Database unavailable' })
		}
	})

	return app
}

// ─── Start ────────────────────────────────────────────────────────────────────

if (process.env.NODE_ENV !== 'test') {
	const registryAddress = process.env.WORKFLOW_REGISTRY_ADDRESS
	const port = Number(process.env.PORT ?? 3000)

	console.log('CREHub Backend — starting up...')

	const start = async () => {
		const { connectDb } = await import('./db')
		await connectDb()

		if (registryAddress) {
			console.log(`  WorkflowRegistry: ${registryAddress}`)
			const { bootstrap, startListener } = await import('./listener')
			await bootstrap(registryAddress as `0x${string}`, searchIndex)
			startListener(registryAddress as `0x${string}`, searchIndex)
		} else {
			console.log('  WORKFLOW_REGISTRY_ADDRESS not set — skipping bootstrap and listener')
		}

		const app = createApp()
		app.listen(port, () => {
			console.log(`CREHub Backend running on http://localhost:${port}`)
			console.log('Routes:')
			console.log('  GET  /api/workflows')
			console.log('  GET  /api/workflows/search?q=<query>')
			console.log('  GET  /api/workflows/:workflowId')
			console.log('  POST /api/trigger/:workflowId')
		})
	}

	start().catch((err) => {
		console.error('Fatal startup error:', err)
		process.exit(1)
	})
}
