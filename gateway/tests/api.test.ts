/**
 * Phase 2 – API route tests
 *
 * Tests /health, /workflows, and /trigger/:workflowId using Express test client.
 * The db module is mocked — no real MongoDB connection needed.
 */
import { describe, expect, test, beforeAll, mock } from 'bun:test'
import http from 'node:http'
import type { WorkflowMetadata } from '../src/types'

// ─── Mock workflow ─────────────────────────────────────────────────────────────

const MOCK_WORKFLOW: WorkflowMetadata = {
	workflowId: 'wf_test_01',
	creatorAddress: '0xf39Fd6e51aad88F6f4ce6aB8827279cffFb92266',
	pricePerInvocation: '10000',
	description: 'Test health factor monitor',
	detailedDescription: 'Checks Aave v3 health factor for a wallet.',
	inputs:  [{ name: 'walletAddress', type: 'address', description: 'Wallet to check', required: true }],
	outputs: [
		{ name: 'healthFactor', type: 'number', description: 'Health factor', required: true },
		{ name: 'riskLevel',    type: 'string', description: 'Risk level',    required: true },
	],
	category: 'defi',
	active: true,
	workflowDir: '/tmp/fake-workflow',
}

// ─── Mock db module (must be before createApp import) ─────────────────────────

mock.module('../src/db', () => ({
	connectDb:    async () => {},
	closeDb:      async () => {},
	getAllActive:  async (_defaultDir: string) => [MOCK_WORKFLOW],
	getOne: async (workflowId: string, _defaultDir: string) =>
		workflowId === MOCK_WORKFLOW.workflowId ? MOCK_WORKFLOW : null,
}))

// ─── Import app after mocks ───────────────────────────────────────────────────

import { createApp } from '../src/index'

// ─── Test helper ──────────────────────────────────────────────────────────────

const fetchApp = async (
	app: ReturnType<typeof createApp>,
	path: string,
	opts: RequestInit = {},
) => {
	const server = http.createServer(app)
	await new Promise<void>((resolve) => server.listen(0, resolve))
	const { port } = server.address() as { port: number }
	const url = `http://localhost:${port}${path}`
	try {
		return await fetch(url, opts)
	} finally {
		await new Promise<void>((resolve) => server.close(() => resolve()))
	}
}

// ─── GET /health ──────────────────────────────────────────────────────────────

describe('GET /health', () => {
	test('returns 200 with status ok', async () => {
		const app = createApp()
		const res = await fetchApp(app, '/health')
		expect(res.status).toBe(200)
		const body = (await res.json()) as Record<string, unknown>
		expect(body.status).toBe('ok')
		expect(typeof body.timestamp).toBe('string')
	})
})

// ─── GET /workflows ───────────────────────────────────────────────────────────

describe('GET /workflows', () => {
	test('returns registered workflows without workflowDir', async () => {
		const app = createApp()
		const res = await fetchApp(app, '/workflows')
		expect(res.status).toBe(200)
		const body = (await res.json()) as Record<string, unknown>[]

		const found = body.find((w) => w.workflowId === 'wf_test_01')
		expect(found).toBeDefined()
		expect(found).not.toHaveProperty('workflowDir')
		expect(found).toHaveProperty('pricePerInvocation')
	})
})

// ─── POST /trigger/:workflowId ────────────────────────────────────────────────

describe('POST /trigger/:workflowId', () => {
	test('returns 402 when X-PAYMENT header is missing', async () => {
		const app = createApp()
		const res = await fetchApp(app, '/trigger/wf_test_01', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ walletAddress: '0x1234567890123456789012345678901234567890' }),
		})

		expect(res.status).toBe(402)
		const body = (await res.json()) as { error: string; paymentDetails: Record<string, unknown> }
		expect(body.error).toBe('Payment required')
		expect(body.paymentDetails).toBeDefined()
		expect(body.paymentDetails.chainId).toBe(11155111)
		expect(body.paymentDetails.token).toBe('0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238')
	})

	test('returns 402 response with correct amount matching workflow price', async () => {
		const app = createApp()
		const res = await fetchApp(app, '/trigger/wf_test_01', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({}),
		})

		const body = (await res.json()) as { paymentDetails: Record<string, unknown> }
		expect(body.paymentDetails.amount).toBe('10000')
	})

	test('returns 402 or 404 for unknown workflow', async () => {
		const app = createApp()
		const res = await fetchApp(app, '/trigger/nonexistent_workflow', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({}),
		})
		expect(res.status).toBeOneOf([402, 404])
	})

	test('402 paymentDetails includes network, payTo, token fields', async () => {
		process.env.PLATFORM_WALLET = '0xf39Fd6e51aad88F6f4ce6aB8827279cffFb92266'
		const app = createApp()
		const res = await fetchApp(app, '/trigger/wf_test_01', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({}),
		})

		const body = (await res.json()) as { paymentDetails: Record<string, unknown> }
		expect(body.paymentDetails.network).toBe('ethereum-sepolia')
		expect(body.paymentDetails.payTo).toBeTruthy()
		expect(body.paymentDetails.token).toBeTruthy()
	})
})
