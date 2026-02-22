/**
 * API route tests
 *
 * Mocks the db module so no real MongoDB connection is needed.
 * Tests /health, /api/workflows, /api/workflows/search, /api/workflows/:workflowId
 */
import { describe, expect, test, beforeAll, mock } from 'bun:test'
import http from 'node:http'
import type { WorkflowListing } from '../src/types'
import type { Hex } from 'viem'

// ─── Mock db module (must be before createApp import) ─────────────────────────

const MOCK_LISTINGS: WorkflowListing[] = [
	{
		metadata: {
			workflowId: 'wf_hf_monitor_01',
			creatorAddress: '0xf39Fd6e51aad88F6f4ce6aB8827279cffFb92266' as Hex,
			pricePerInvocation: 10_000n,
			description: 'Returns the health factor for an Aave v3 lending position.',
			detailedDescription: 'Checks Aave v3 health factor. Returns ratio and risk level.',
			category: 'defi',
			active: true,
			registeredAt: 0n,
		},
		inputs:  [{ name: 'walletAddress', fieldType: 'address', description: 'Wallet', required: true }],
		outputs: [
			{ name: 'healthFactor', fieldType: 'number', description: 'Health factor', required: true },
			{ name: 'riskLevel',    fieldType: 'string', description: 'Risk level',    required: true },
		],
	},
	{
		metadata: {
			workflowId: 'wf_price_feed_01',
			creatorAddress: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Hex,
			pricePerInvocation: 5_000n,
			description: 'Fetches the latest Chainlink price feed value for any pair.',
			detailedDescription: 'Reads a Chainlink Data Feed and returns the latest price.',
			category: 'data',
			active: true,
			registeredAt: 0n,
		},
		inputs:  [{ name: 'feedAddress', fieldType: 'address', description: 'Feed address', required: true }],
		outputs: [{ name: 'price', fieldType: 'number', description: 'Latest price', required: true }],
	},
]

mock.module('../src/db', () => ({
	getAllActive: async () => MOCK_LISTINGS,
	getOne: async (workflowId: string) =>
		MOCK_LISTINGS.find((l) => l.metadata.workflowId === workflowId) ?? null,
	connectDb: async () => {},
	closeDb:   async () => {},
	upsertWorkflow:      async () => {},
	updateWorkflowStatus: async () => {},
}))

// ─── Import app after mocks are in place ──────────────────────────────────────

import { createApp, searchIndex } from '../src/index'
import { setEmbedder } from '../src/search'
import { buildSearchText } from '../src/search'

// ─── Mock embedder ────────────────────────────────────────────────────────────

const mockEmbed = async (text: string): Promise<Float32Array> => {
	const vec = new Float32Array(3)
	if (text.toLowerCase().includes('defi'))                                      vec[0] = 1
	else if (text.toLowerCase().includes('data') || text.toLowerCase().includes('price')) vec[1] = 1
	else                                                                          vec[2] = 1
	return vec
}

// ─── HTTP test helper ─────────────────────────────────────────────────────────

const fetchApp = async (
	app: ReturnType<typeof createApp>,
	path: string,
	opts: RequestInit = {},
) => {
	const server = http.createServer(app)
	await new Promise<void>((resolve) => server.listen(0, resolve))
	const { port } = server.address() as { port: number }
	try {
		return await fetch(`http://localhost:${port}${path}`, opts)
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()))
	}
}

// ─── Setup ────────────────────────────────────────────────────────────────────

let app: ReturnType<typeof createApp>

beforeAll(async () => {
	setEmbedder(mockEmbed)
	await searchIndex.rebuild(
		MOCK_LISTINGS.map((l) => ({
			id: l.metadata.workflowId,
			text: buildSearchText({
				workflowId: l.metadata.workflowId,
				description: l.metadata.description,
				detailedDescription: l.metadata.detailedDescription,
				category: l.metadata.category,
			}),
		})),
	)
	app = createApp()
})

// ─── GET /health ──────────────────────────────────────────────────────────────

describe('GET /health', () => {
	test('returns 200 with status ok', async () => {
		const res = await fetchApp(app, '/health')
		expect(res.status).toBe(200)
		const body = (await res.json()) as Record<string, unknown>
		expect(body.status).toBe('ok')
		expect(typeof body.timestamp).toBe('string')
	})
})

// ─── GET /api/workflows ───────────────────────────────────────────────────────

describe('GET /api/workflows', () => {
	test('returns all active listings', async () => {
		const res = await fetchApp(app, '/api/workflows')
		expect(res.status).toBe(200)
		const body = (await res.json()) as Record<string, unknown>[]
		expect(body.length).toBe(2)
	})

	test('listings include required fields', async () => {
		const res = await fetchApp(app, '/api/workflows')
		const body = (await res.json()) as Record<string, unknown>[]
		const wf = body.find((w) => w.workflowId === 'wf_hf_monitor_01')
		expect(wf).toBeDefined()
		expect(wf!.description).toBeTruthy()
		expect(wf!.pricePerInvocation).toBe('10000')
		expect(wf!.category).toBe('defi')
		expect(Array.isArray(wf!.inputs)).toBe(true)
		expect(Array.isArray(wf!.outputs)).toBe(true)
	})

	test('pricePerInvocation is serialised as string (bigint safe)', async () => {
		const res = await fetchApp(app, '/api/workflows')
		const body = (await res.json()) as Record<string, unknown>[]
		for (const wf of body) expect(typeof wf.pricePerInvocation).toBe('string')
	})
})

// ─── GET /api/workflows/search ────────────────────────────────────────────────

describe('GET /api/workflows/search', () => {
	test('returns 400 when q is missing', async () => {
		const res = await fetchApp(app, '/api/workflows/search')
		expect(res.status).toBe(400)
	})

	test('returns search results with score', async () => {
		const res = await fetchApp(app, '/api/workflows/search?q=defi+health+factor')
		expect(res.status).toBe(200)
		const body = (await res.json()) as Record<string, unknown>[]
		expect(body.length).toBeGreaterThan(0)
		expect(typeof body[0].score).toBe('number')
	})

	test('defi query returns defi workflows first', async () => {
		const res = await fetchApp(app, '/api/workflows/search?q=defi+aave')
		const body = (await res.json()) as Record<string, unknown>[]
		expect(body[0].workflowId).toBe('wf_hf_monitor_01')
	})

	test('data/price query returns price feed workflow', async () => {
		const res = await fetchApp(app, '/api/workflows/search?q=price+data')
		const body = (await res.json()) as Record<string, unknown>[]
		expect(body[0].workflowId).toBe('wf_price_feed_01')
	})

	test('respects limit query param', async () => {
		const res = await fetchApp(app, '/api/workflows/search?q=anything&limit=1')
		const body = (await res.json()) as unknown[]
		expect(body.length).toBeLessThanOrEqual(1)
	})
})

// ─── GET /api/workflows/:workflowId ──────────────────────────────────────────

describe('GET /api/workflows/:workflowId', () => {
	test('returns 200 for known workflow', async () => {
		const res = await fetchApp(app, '/api/workflows/wf_hf_monitor_01')
		expect(res.status).toBe(200)
		const body = (await res.json()) as Record<string, unknown>
		expect(body.workflowId).toBe('wf_hf_monitor_01')
	})

	test('returns 404 for unknown workflow', async () => {
		const res = await fetchApp(app, '/api/workflows/wf_does_not_exist')
		expect(res.status).toBe(404)
	})

	test('response includes inputs and outputs arrays', async () => {
		const res = await fetchApp(app, '/api/workflows/wf_hf_monitor_01')
		const body = (await res.json()) as Record<string, unknown>
		expect(Array.isArray(body.inputs)).toBe(true)
		expect(Array.isArray(body.outputs)).toBe(true)
		expect((body.inputs as unknown[]).length).toBeGreaterThan(0)
	})
})
