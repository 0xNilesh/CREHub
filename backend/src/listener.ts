/**
 * On-chain event listener for WorkflowRegistry.
 *
 * bootstrap()     — fetches all existing on-chain workflows on startup
 *                   and upserts them into MongoDB, then rebuilds search index.
 * startListener() — watches for WorkflowListed and WorkflowUpdated events;
 *                   upserts / updates MongoDB and rebuilds the search index.
 *                   Returns an unwatch function to stop listening.
 */
import { REGISTRY_ABI, getClient, RegistryReader } from './registry'
import { upsertWorkflow, updateWorkflowStatus, getAllActive } from './db'
import { SearchIndex, buildSearchText } from './search'
import type { Hex } from 'viem'
import type { WorkflowListing } from './types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const rebuildIndex = async (index: SearchIndex): Promise<void> => {
	const listings = await getAllActive()
	await index.rebuild(
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
	console.log(`[listener] Search index rebuilt (${index.size} entries)`)
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

/**
 * Fetch all existing on-chain workflows and upsert into MongoDB.
 * Called once on server startup so the DB is consistent with chain state
 * even after downtime.
 */
export const bootstrap = async (address: Hex, index: SearchIndex): Promise<void> => {
	const reader = new RegistryReader(address)
	console.log('[listener] Bootstrapping from chain...')

	const listings = await reader.fetchAll()
	await Promise.all(listings.map(upsertWorkflow))
	console.log(`[listener] Bootstrapped ${listings.length} workflows into MongoDB`)

	await rebuildIndex(index)
}

// ─── Live listener ────────────────────────────────────────────────────────────

/**
 * Watch for WorkflowListed and WorkflowUpdated events.
 * Returns an unwatch function — call it to stop listening.
 */
export const startListener = (address: Hex, index: SearchIndex): (() => void) => {
	const client = getClient()

	// Fallback: re-sync from chain every 30 s in case watchContractEvent
	// misses events (RPC rate-limits, polling gaps, backend restarts).
	const syncInterval = setInterval(async () => {
		try {
			const reader = new RegistryReader(address)
			const listings = await reader.fetchAll()
			if (listings.length > 0) {
				await Promise.all(listings.map(upsertWorkflow))
				await rebuildIndex(index)
			}
		} catch (err) {
			console.error('[listener] Periodic sync error:', err)
		}
	}, 30_000)

	const unwatchListed = client.watchContractEvent({
		address,
		abi: REGISTRY_ABI,
		eventName: 'WorkflowListed',
		onLogs: async (logs) => {
			for (const log of logs) {
				const { metadata, inputs, outputs } = log.args
				if (!metadata || !inputs || !outputs) continue

				const listing: WorkflowListing = {
					metadata: {
						workflowId: metadata.workflowId,
						creatorAddress: metadata.creatorAddress,
						pricePerInvocation: metadata.pricePerInvocation,
						description: metadata.description,
						detailedDescription: metadata.detailedDescription,
						category: metadata.category,
						active: metadata.active,
						registeredAt: metadata.registeredAt,
					},
					inputs: inputs.map((f) => ({
						name: f.name,
						fieldType: f.fieldType,
						description: f.description,
						required: f.required,
					})),
					outputs: outputs.map((f) => ({
						name: f.name,
						fieldType: f.fieldType,
						description: f.description,
						required: f.required,
					})),
				}

				await upsertWorkflow(listing)
				console.log(`[listener] WorkflowListed: ${metadata.workflowId}`)
				await rebuildIndex(index)
			}
		},
		onError: (err) => console.error('[listener] WorkflowListed watch error:', err),
	})

	const unwatchUpdated = client.watchContractEvent({
		address,
		abi: REGISTRY_ABI,
		eventName: 'WorkflowUpdated',
		onLogs: async (logs) => {
			for (const log of logs) {
				const { workflowId, pricePerInvocation, active } = log.args
				if (workflowId === undefined || pricePerInvocation === undefined || active === undefined)
					continue

				await updateWorkflowStatus(workflowId, pricePerInvocation, active)
				console.log(
					`[listener] WorkflowUpdated: ${workflowId} price=${pricePerInvocation} active=${active}`,
				)
				await rebuildIndex(index)
			}
		},
		onError: (err) => console.error('[listener] WorkflowUpdated watch error:', err),
	})

	// Immediate catch-up in case events were emitted between bootstrap and now
	setImmediate(async () => {
		try {
			const reader = new RegistryReader(address)
			const listings = await reader.fetchAll()
			if (listings.length > 0) {
				await Promise.all(listings.map(upsertWorkflow))
				await rebuildIndex(index)
				console.log(`[listener] Catch-up sync: ${listings.length} workflow(s) upserted`)
			}
		} catch (err) {
			console.error('[listener] Catch-up sync error:', err)
		}
	})

	console.log('[listener] Watching WorkflowListed and WorkflowUpdated events (+ 30s fallback sync)')
	return () => {
		clearInterval(syncInterval)
		unwatchListed()
		unwatchUpdated()
	}
}
