/**
 * WorkflowCache — thin async wrapper over MongoDB.
 *
 * In production (useDb=true):  getAll/getOne query MongoDB.
 * In tests (useDb=false):      getAll/getOne use an in-memory Map seeded via seed().
 *
 * The RegistryReader parameter is kept for constructor compatibility with tests
 * but is no longer used internally — chain polling is replaced by the event
 * listener in listener.ts.
 */
import { getAllActive, getOne as dbGetOne } from './db'
import { SearchIndex, buildSearchText } from './search'
import type { RegistryReader } from './registry'
import type { WorkflowListing } from './types'

export class WorkflowCache {
	private _listings: Map<string, WorkflowListing> = new Map()
	private _index: SearchIndex
	private _ready = false
	private _useDb = false

	constructor(_reader: RegistryReader | undefined, index: SearchIndex) {
		this._index = index
	}

	// ── Configuration (called by index.ts startup) ─────────────────────────────

	setUseDb(useDb: boolean): void {
		this._useDb = useDb
	}

	setReady(ready: boolean): void {
		this._ready = ready
	}

	// ── State ──────────────────────────────────────────────────────────────────

	get ready(): boolean {
		return this._ready
	}

	// ── Read ───────────────────────────────────────────────────────────────────

	async getAll(): Promise<WorkflowListing[]> {
		if (this._useDb) return getAllActive()
		return [...this._listings.values()].filter((l) => l.metadata.active)
	}

	async getOne(workflowId: string): Promise<WorkflowListing | null> {
		if (this._useDb) return dbGetOne(workflowId)
		return this._listings.get(workflowId) ?? null
	}

	getIndex(): SearchIndex {
		return this._index
	}

	// ── Seed (used by tests — populates the in-memory Map) ────────────────────

	async seed(listings: WorkflowListing[]): Promise<void> {
		this._listings.clear()
		for (const l of listings) this._listings.set(l.metadata.workflowId, l)

		await this._index.rebuild(
			listings.map((l) => ({
				id: l.metadata.workflowId,
				text: buildSearchText({
					workflowId: l.metadata.workflowId,
					description: l.metadata.description,
					detailedDescription: l.metadata.detailedDescription,
					category: l.metadata.category,
				}),
			})),
		)
		this._ready = true
	}
}
