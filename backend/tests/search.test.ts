/**
 * Phase 4 – search.ts tests
 *
 * Tests SearchIndex, cosineSimilarity, and buildSearchText using a
 * deterministic mock embedder (no model download required).
 */
import { describe, expect, test, beforeEach } from 'bun:test'
import { SearchIndex, cosineSimilarity, buildSearchText, setEmbedder } from '../src/search'

// ─── Deterministic mock embedder ──────────────────────────────────────────────
// Each "word" maps to a fixed dimension. Similarity is based on shared words.

const VOCAB: Record<string, number> = {
	defi: 0,
	health: 1,
	factor: 2,
	aave: 3,
	price: 4,
	feed: 5,
	chainlink: 6,
	monitor: 7,
	wallet: 8,
	balance: 9,
}
const DIM = Object.keys(VOCAB).length

const mockEmbed = async (text: string): Promise<Float32Array> => {
	const vec = new Float32Array(DIM)
	const words = text.toLowerCase().split(/\s+/)
	for (const w of words) {
		if (w in VOCAB) vec[VOCAB[w]] += 1
	}
	// L2 normalise
	const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0))
	if (norm > 0) for (let i = 0; i < DIM; i++) vec[i] /= norm
	return vec
}

// Inject mock embedder before every test
beforeEach(() => setEmbedder(mockEmbed))

// ─── cosineSimilarity ─────────────────────────────────────────────────────────

describe('cosineSimilarity', () => {
	test('identical vectors → similarity 1', () => {
		const a = new Float32Array([1, 0, 0])
		const b = new Float32Array([1, 0, 0])
		expect(cosineSimilarity(a, b)).toBeCloseTo(1, 5)
	})

	test('orthogonal vectors → similarity 0', () => {
		const a = new Float32Array([1, 0, 0])
		const b = new Float32Array([0, 1, 0])
		expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5)
	})

	test('opposite vectors → similarity -1', () => {
		const a = new Float32Array([1, 0, 0])
		const b = new Float32Array([-1, 0, 0])
		expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 5)
	})
})

// ─── buildSearchText ──────────────────────────────────────────────────────────

describe('buildSearchText', () => {
	test('concatenates id, description, detailedDescription, category', () => {
		const text = buildSearchText({
			workflowId: 'wf_1',
			description: 'hello',
			detailedDescription: 'world',
			category: 'defi',
		})
		expect(text).toContain('wf_1')
		expect(text).toContain('hello')
		expect(text).toContain('world')
		expect(text).toContain('defi')
	})

	test('filters out empty strings', () => {
		const text = buildSearchText({
			workflowId: 'wf_1',
			description: '',
			detailedDescription: 'detail',
			category: 'data',
		})
		expect(text).not.toContain('  ') // no double spaces from empty parts
	})
})

// ─── SearchIndex ──────────────────────────────────────────────────────────────

describe('SearchIndex', () => {
	test('add and query returns matching entry', async () => {
		const idx = new SearchIndex()
		await idx.add('wf_health', 'defi health factor aave')
		await idx.add('wf_price', 'price feed chainlink data')

		const hits = await idx.query('defi health factor', 5)
		expect(hits.length).toBeGreaterThan(0)
		expect(hits[0].id).toBe('wf_health')
		expect(hits[0].score).toBeGreaterThan(0)
	})

	test('returns top-K results ordered by score descending', async () => {
		const idx = new SearchIndex()
		await idx.add('wf_a', 'defi health factor aave')
		await idx.add('wf_b', 'price feed chainlink')
		await idx.add('wf_c', 'wallet monitor balance')

		const hits = await idx.query('chainlink price feed', 3)
		expect(hits[0].score).toBeGreaterThanOrEqual(hits[1]?.score ?? -Infinity)
	})

	test('returns empty array when index is empty', async () => {
		const idx = new SearchIndex()
		const hits = await idx.query('anything', 5)
		expect(hits).toEqual([])
	})

	test('topK limits results', async () => {
		const idx = new SearchIndex()
		for (let i = 0; i < 10; i++) {
			await idx.add(`wf_${i}`, `defi health factor ${i}`)
		}
		const hits = await idx.query('health factor', 3)
		expect(hits.length).toBeLessThanOrEqual(3)
	})

	test('rebuild replaces all entries', async () => {
		const idx = new SearchIndex()
		await idx.add('wf_old', 'old text')
		expect(idx.size).toBe(1)

		await idx.rebuild([
			{ id: 'wf_new1', text: 'new defi health' },
			{ id: 'wf_new2', text: 'chainlink price feed' },
		])

		expect(idx.size).toBe(2)
		const hits = await idx.query('old', 5)
		const ids = hits.map((h) => h.id)
		expect(ids).not.toContain('wf_old')
	})

	test('clear empties the index', async () => {
		const idx = new SearchIndex()
		await idx.add('wf_a', 'some text')
		idx.clear()
		expect(idx.size).toBe(0)
	})

	test('size reflects number of entries', async () => {
		const idx = new SearchIndex()
		expect(idx.size).toBe(0)
		await idx.add('wf_a', 'text a')
		await idx.add('wf_b', 'text b')
		expect(idx.size).toBe(2)
	})
})
