/**
 * CREHub Marketplace Backend API
 *
 * Routes:
 *   GET  /api/workflows                  → list all active listings
 *   GET  /api/workflows/search?q=<query> → semantic search
 *   GET  /api/workflows/:workflowId      → workflow detail
 *   POST /api/trigger/:workflowId        → proxy to x402 gateway
 *
 * Startup sequence:
 *   1. connectDb()                        — connect to MongoDB
 *   2. bootstrap(registryAddress, index)  — sync existing on-chain workflows into MongoDB
 *   3. startListener(registryAddress, index) — watch WorkflowListed / WorkflowUpdated events
 *   4. cache.setReady(true)
 *   5. app.listen()
 */
import express, { type Request, type Response } from 'express'
import cors from 'cors'
import { RegistryReader } from './registry'
import { SearchIndex } from './search'
import { WorkflowCache } from './cache'
import { proxyTrigger } from './gateway'
import { toWorkflowResponse } from './types'

// ─── App factory ──────────────────────────────────────────────────────────────
// Accepts an injected cache so tests can seed their own data without a real DB.

export const createApp = (cache: WorkflowCache) => {
	const app = express()
	app.use(cors())
	app.use(express.json())

	// ── Health ─────────────────────────────────────────────────────────────────
	app.get('/health', async (_req: Request, res: Response) => {
		const listings = await cache.getAll()
		res.json({
			status: 'ok',
			timestamp: new Date().toISOString(),
			cacheReady: cache.ready,
			listingCount: listings.length,
		})
	})

	// ── List all workflows ─────────────────────────────────────────────────────
	app.get('/api/workflows', async (_req: Request, res: Response) => {
		const listings = await cache.getAll()
		res.json(listings.map(toWorkflowResponse))
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
			const hits = await cache.getIndex().query(q.trim(), topK)
			const results = (
				await Promise.all(
					hits.map(async (hit) => {
						const listing = await cache.getOne(hit.id)
						if (!listing) return null
						return { ...toWorkflowResponse(listing), score: hit.score }
					}),
				)
			).filter(Boolean)

			res.json(results)
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'Search failed'
			res.status(500).json({ error: msg })
		}
	})

	// ── Workflow detail ────────────────────────────────────────────────────────
	app.get('/api/workflows/:workflowId', async (req: Request, res: Response) => {
		const listing = await cache.getOne(req.params.workflowId)
		if (!listing) return res.status(404).json({ error: `Workflow '${req.params.workflowId}' not found` })
		res.json(toWorkflowResponse(listing))
	})

	// ── Trigger proxy ──────────────────────────────────────────────────────────
	app.post('/api/trigger/:workflowId', proxyTrigger)

	return app
}

// ─── Start ────────────────────────────────────────────────────────────────────

if (process.env.NODE_ENV !== 'test') {
	const registryAddress = process.env.WORKFLOW_REGISTRY_ADDRESS
	const port = Number(process.env.PORT ?? 3000)

	const index = new SearchIndex()
	const reader = new RegistryReader(registryAddress)
	const cache = new WorkflowCache(reader, index)

	console.log('CREHub Backend — starting up...')

	const start = async () => {
		const { connectDb } = await import('./db')
		await connectDb()
		cache.setUseDb(true)

		if (registryAddress) {
			console.log(`  WorkflowRegistry: ${registryAddress}`)
			const { bootstrap, startListener } = await import('./listener')
			await bootstrap(registryAddress as `0x${string}`, index)
			startListener(registryAddress as `0x${string}`, index)
		} else {
			console.log('  WORKFLOW_REGISTRY_ADDRESS not set — skipping bootstrap and listener')
		}

		cache.setReady(true)

		const app = createApp(cache)
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
