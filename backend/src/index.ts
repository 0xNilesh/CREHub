/**
 * CREHub Marketplace Backend API
 *
 * Routes:
 *   GET  /api/workflows                  → list all active listings
 *   GET  /api/workflows/search?q=<query> → semantic search
 *   GET  /api/workflows/:workflowId      → workflow detail
 *   POST /api/trigger/:workflowId        → proxy to x402 gateway
 *   POST /api/workflows/list             → creator submits new listing (demo: in-memory)
 *
 * Startup sequence:
 *   1. Build WorkflowCache (reads chain or uses demo seeds)
 *   2. Build SearchIndex (embeds listings via sentence-transformers)
 *   3. Start Express server
 */
import express, { type Request, type Response } from 'express'
import cors from 'cors'
import { z } from 'zod'
import { RegistryReader } from './registry'
import { SearchIndex } from './search'
import { WorkflowCache } from './cache'
import { proxyTrigger } from './gateway'
import { toWorkflowResponse, type WorkflowListing, type WorkflowIOField } from './types'
import type { Hex } from 'viem'

// ─── App factory ──────────────────────────────────────────────────────────────
// Accepts an injected cache so tests can seed their own data.

export const createApp = (cache: WorkflowCache) => {
	const app = express()
	app.use(cors())
	app.use(express.json())

	// ── Health ─────────────────────────────────────────────────────────────────
	app.get('/health', (_req: Request, res: Response) => {
		res.json({
			status: 'ok',
			timestamp: new Date().toISOString(),
			cacheReady: cache.ready,
			listingCount: cache.getAll().length,
		})
	})

	// ── List all workflows ─────────────────────────────────────────────────────
	app.get('/api/workflows', (_req: Request, res: Response) => {
		const listings = cache.getAll().map(toWorkflowResponse)
		res.json(listings)
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
			const results = hits
				.map((hit) => {
					const listing = cache.getOne(hit.id)
					if (!listing) return null
					return { ...toWorkflowResponse(listing), score: hit.score }
				})
				.filter(Boolean)

			res.json(results)
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'Search failed'
			res.status(500).json({ error: msg })
		}
	})

	// ── Workflow detail ────────────────────────────────────────────────────────
	app.get('/api/workflows/:workflowId', (req: Request, res: Response) => {
		const listing = cache.getOne(req.params.workflowId)
		if (!listing) return res.status(404).json({ error: `Workflow '${req.params.workflowId}' not found` })
		res.json(toWorkflowResponse(listing))
	})

	// ── Trigger proxy ──────────────────────────────────────────────────────────
	app.post('/api/trigger/:workflowId', proxyTrigger)

	// ── Creator: list new workflow ─────────────────────────────────────────────
	// Demo mode: stores in-memory and returns the calldata for on-chain registration.
	// Production: creator signs + broadcasts the returned calldata themselves.
	const IOFieldSchema = z.object({
		name: z.string().min(1),
		fieldType: z.enum(['string', 'number', 'boolean', 'address']),
		description: z.string(),
		required: z.boolean(),
	})

	const ListingSchema = z.object({
		workflowId: z.string().min(1).max(64).regex(/^[a-z0-9_]+$/, 'Use lowercase, digits, underscores'),
		pricePerInvocation: z.string().regex(/^\d+$/, 'Must be a non-negative integer string (USDC wei)'),
		description: z.string().min(1).max(160),
		detailedDescription: z.string().min(1),
		category: z.enum(['defi', 'monitoring', 'data', 'compute']),
		creatorAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Must be a valid EVM address'),
		inputs: z.array(IOFieldSchema).min(0).max(20),
		outputs: z.array(IOFieldSchema).min(1).max(20),
	})

	app.post('/api/workflows/list', (req: Request, res: Response) => {
		const parsed = ListingSchema.safeParse(req.body)
		if (!parsed.success) {
			return res.status(400).json({ error: 'Validation failed', details: parsed.error.flatten() })
		}

		const body = parsed.data

		if (cache.getOne(body.workflowId)) {
			return res.status(409).json({ error: `Workflow '${body.workflowId}' already exists` })
		}

		// Build an in-memory listing
		const listing: WorkflowListing = {
			metadata: {
				workflowId: body.workflowId,
				creatorAddress: body.creatorAddress as Hex,
				pricePerInvocation: BigInt(body.pricePerInvocation),
				description: body.description,
				detailedDescription: body.detailedDescription,
				category: body.category,
				active: true,
				registeredAt: BigInt(Math.floor(Date.now() / 1000)),
			},
			inputs: body.inputs as WorkflowIOField[],
			outputs: body.outputs as WorkflowIOField[],
		}

		// Add to cache + search index asynchronously (don't block response)
		void cache.seed([...cache.getAll().map((l) => ({ ...l })), listing])

		res.status(201).json({
			message: 'Workflow listed (demo: in-memory). Deploy to chain via WorkflowRegistry.listWorkflow().',
			workflow: toWorkflowResponse(listing),
		})
	})

	return app
}

// ─── Start ────────────────────────────────────────────────────────────────────

if (process.env.NODE_ENV !== 'test') {
	const registryAddress = process.env.WORKFLOW_REGISTRY_ADDRESS
	const refreshMs = Number(process.env.REFRESH_INTERVAL_MS ?? 60_000)
	const port = Number(process.env.PORT ?? 4000)

	const reader = new RegistryReader(registryAddress)
	const index = new SearchIndex()
	const cache = new WorkflowCache(reader, index)

	console.log('CREHub Backend — starting up...')
	if (!registryAddress) {
		console.log('  WORKFLOW_REGISTRY_ADDRESS not set → using demo listings')
	} else {
		console.log(`  WorkflowRegistry: ${registryAddress}`)
	}

	cache.start(refreshMs).then(() => {
		const app = createApp(cache)
		app.listen(port, () => {
			console.log(`CREHub Backend running on http://localhost:${port}`)
			console.log('Routes:')
			console.log('  GET  /api/workflows')
			console.log('  GET  /api/workflows/search?q=<query>')
			console.log('  GET  /api/workflows/:workflowId')
			console.log('  POST /api/trigger/:workflowId')
			console.log('  POST /api/workflows/list')
		})
	})
}
