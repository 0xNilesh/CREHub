/**
 * Embedding-based semantic search.
 *
 * Uses @xenova/transformers (all-MiniLM-L6-v2) to embed workflow text.
 * The model is lazy-loaded on first query (cached to disk by transformers).
 *
 * For testing: inject a deterministic embedder via setEmbedder().
 * For production: embedder auto-downloads the model on first use.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type EmbeddingFn = (text: string) => Promise<Float32Array>

export interface SearchEntry {
	id: string
	text: string // concatenated description for embedding
	embedding: Float32Array
}

export interface SearchHit {
	id: string
	score: number // cosine similarity [0, 1]
}

// ─── Embedder (lazy-loaded, injectable) ──────────────────────────────────────

let _embedder: EmbeddingFn | undefined

export const setEmbedder = (fn: EmbeddingFn | undefined) => {
	_embedder = fn
}

const getEmbedder = async (): Promise<EmbeddingFn> => {
	if (_embedder) return _embedder

	// Lazy-load @xenova/transformers (downloads model on first call, then cached)
	const { pipeline } = await import('@xenova/transformers')
	const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2')

	_embedder = async (text: string): Promise<Float32Array> => {
		const output = await extractor(text, { pooling: 'mean', normalize: true })
		return output.data as Float32Array
	}

	return _embedder
}

// ─── Math helpers ─────────────────────────────────────────────────────────────

/** Cosine similarity between two L2-normalised vectors. */
export const cosineSimilarity = (a: Float32Array, b: Float32Array): number => {
	let dot = 0
	for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
	return dot // both normalised → dot product == cosine similarity
}

// ─── SearchIndex ──────────────────────────────────────────────────────────────

export class SearchIndex {
	private entries: SearchEntry[] = []

	/** Add a workflow to the index. Computes and stores its embedding. */
	async add(id: string, text: string): Promise<void> {
		const embedder = await getEmbedder()
		const embedding = await embedder(text)
		this.entries.push({ id, text, embedding })
	}

	/** Query top-K workflows by cosine similarity. */
	async query(q: string, topK = 5): Promise<SearchHit[]> {
		if (this.entries.length === 0) return []

		const embedder = await getEmbedder()
		const qVec = await embedder(q)

		return this.entries
			.map((e) => ({ id: e.id, score: cosineSimilarity(qVec, e.embedding) }))
			.sort((a, b) => b.score - a.score)
			.slice(0, topK)
	}

	/** Replace all entries (used on cache refresh). */
	async rebuild(items: Array<{ id: string; text: string }>): Promise<void> {
		this.entries = []
		await Promise.all(items.map((item) => this.add(item.id, item.text)))
	}

	clear(): void {
		this.entries = []
	}

	get size(): number {
		return this.entries.length
	}
}

/** Build the search text for a workflow (what gets embedded). */
export const buildSearchText = (params: {
	workflowId: string
	description: string
	detailedDescription: string
	category: string
}): string =>
	[params.workflowId, params.description, params.detailedDescription, params.category]
		.filter(Boolean)
		.join(' ')
