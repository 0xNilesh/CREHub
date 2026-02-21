/**
 * Phase 4 – cache.ts tests
 *
 * Tests WorkflowCache with a mock RegistryReader and mock SearchIndex.
 */
import { describe, expect, test, beforeEach } from 'bun:test'
import { WorkflowCache } from '../src/cache'
import { RegistryReader } from '../src/registry'
import { SearchIndex, setEmbedder } from '../src/search'
import type { WorkflowListing } from '../src/types'
import type { Hex } from 'viem'

// ─── Minimal mock embedder (no model download) ────────────────────────────────

beforeEach(() => setEmbedder(async () => new Float32Array([1, 0, 0])))

// ─── Test fixtures ────────────────────────────────────────────────────────────

const makeListing = (id: string, active = true): WorkflowListing => ({
	metadata: {
		workflowId: id,
		creatorAddress: '0xf39Fd6e51aad88F6f4ce6aB8827279cffFb92266' as Hex,
		pricePerInvocation: 10_000n,
		description: `Description for ${id}`,
		detailedDescription: `Detailed description for ${id}`,
		category: 'defi',
		active,
		registeredAt: 0n,
	},
	inputs: [{ name: 'input1', fieldType: 'string', description: 'An input', required: true }],
	outputs: [{ name: 'output1', fieldType: 'number', description: 'An output', required: true }],
})

// ─── WorkflowCache ────────────────────────────────────────────────────────────

describe('WorkflowCache', () => {
	test('seed() populates cache with provided listings', async () => {
		const reader = new RegistryReader() // no address → not configured
		const index = new SearchIndex()
		const cache = new WorkflowCache(reader, index)

		await cache.seed([makeListing('wf_a'), makeListing('wf_b')])

		expect(cache.getAll().length).toBe(2)
		expect(cache.getOne('wf_a')).toBeDefined()
		expect(cache.getOne('wf_b')).toBeDefined()
	})

	test('getAll() returns only active listings', async () => {
		const reader = new RegistryReader()
		const index = new SearchIndex()
		const cache = new WorkflowCache(reader, index)

		await cache.seed([
			makeListing('wf_active', true),
			makeListing('wf_inactive', false),
		])

		const all = cache.getAll()
		expect(all.find((l) => l.metadata.workflowId === 'wf_active')).toBeDefined()
		expect(all.find((l) => l.metadata.workflowId === 'wf_inactive')).toBeUndefined()
	})

	test('getOne() returns undefined for unknown workflowId', async () => {
		const reader = new RegistryReader()
		const index = new SearchIndex()
		const cache = new WorkflowCache(reader, index)

		await cache.seed([])
		expect(cache.getOne('nonexistent')).toBeUndefined()
	})

	test('seed() rebuilds search index', async () => {
		const reader = new RegistryReader()
		const index = new SearchIndex()
		const cache = new WorkflowCache(reader, index)

		await cache.seed([makeListing('wf_1'), makeListing('wf_2')])
		expect(index.size).toBe(2)
	})

	test('ready is true after seed()', async () => {
		const reader = new RegistryReader()
		const index = new SearchIndex()
		const cache = new WorkflowCache(reader, index)

		expect(cache.ready).toBe(false)
		await cache.seed([])
		expect(cache.ready).toBe(true)
	})

	test('getIndex() returns the search index', async () => {
		const reader = new RegistryReader()
		const index = new SearchIndex()
		const cache = new WorkflowCache(reader, index)
		expect(cache.getIndex()).toBe(index)
	})
})
