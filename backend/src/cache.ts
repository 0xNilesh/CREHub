/**
 * In-memory workflow listing store.
 *
 * Sources (in priority order):
 *   1. WorkflowRegistry.sol on Ethereum Sepolia (if WORKFLOW_REGISTRY_ADDRESS set)
 *   2. Seed demo listings (fallback for dev / when registry not deployed)
 *
 * Refreshes from chain every REFRESH_INTERVAL_MS (default 60 s).
 * Rebuilds the SearchIndex after each refresh.
 */
import type { WorkflowListing } from './types'
import { RegistryReader } from './registry'
import { SearchIndex, buildSearchText } from './search'
import type { Hex } from 'viem'

// ─── Demo seed data ───────────────────────────────────────────────────────────
// Used when WORKFLOW_REGISTRY_ADDRESS is not set (dev / hackathon demo)

const DEMO_LISTINGS: WorkflowListing[] = [
	{
		metadata: {
			workflowId: 'wf_hf_monitor_01',
			creatorAddress: '0xf39Fd6e51aad88F6f4ce6aB8827279cffFb92266' as Hex,
			pricePerInvocation: 10_000n,
			description: 'Returns the health factor for an Aave v3 lending position.',
			detailedDescription:
				'Given a wallet address, queries Aave v3 on Ethereum mainnet and returns the health factor (≥ 1 is safe) and risk level (safe / warning / danger).',
			category: 'defi',
			active: true,
			registeredAt: 0n,
		},
		inputs: [
			{
				name: 'walletAddress',
				fieldType: 'address',
				description: 'Position owner',
				required: true,
			},
			{
				name: 'protocol',
				fieldType: 'string',
				description: "'aave' | 'compound'",
				required: false,
			},
		],
		outputs: [
			{
				name: 'healthFactor',
				fieldType: 'number',
				description: 'Ratio ≥ 1 is safe',
				required: true,
			},
			{
				name: 'riskLevel',
				fieldType: 'string',
				description: "'safe' | 'warning' | 'danger'",
				required: true,
			},
		],
	},
	{
		metadata: {
			workflowId: 'wf_price_feed_01',
			creatorAddress: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as Hex,
			pricePerInvocation: 5_000n,
			description: 'Fetches the latest Chainlink price feed value for any pair.',
			detailedDescription:
				'Reads a Chainlink Data Feed contract and returns the latest answer, decimals, and round ID. Supports any pair with a deployed feed on Ethereum mainnet.',
			category: 'data',
			active: true,
			registeredAt: 0n,
		},
		inputs: [
			{
				name: 'feedAddress',
				fieldType: 'address',
				description: 'Chainlink feed contract address',
				required: true,
			},
		],
		outputs: [
			{ name: 'price', fieldType: 'number', description: 'Latest answer', required: true },
			{
				name: 'decimals',
				fieldType: 'number',
				description: 'Feed decimal precision',
				required: true,
			},
			{ name: 'roundId', fieldType: 'string', description: 'Round ID', required: true },
		],
	},
	{
		metadata: {
			workflowId: 'wf_wallet_monitor_01',
			creatorAddress: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC' as Hex,
			pricePerInvocation: 8_000n,
			description: 'Monitors a wallet for low ETH balance and sends an alert.',
			detailedDescription:
				'Checks the native ETH balance of a wallet address. Returns current balance and whether it falls below the specified threshold. Useful for automated top-up bots.',
			category: 'monitoring',
			active: true,
			registeredAt: 0n,
		},
		inputs: [
			{ name: 'walletAddress', fieldType: 'address', description: 'Wallet to monitor', required: true },
			{
				name: 'thresholdEth',
				fieldType: 'number',
				description: 'Alert below this ETH balance',
				required: false,
			},
		],
		outputs: [
			{ name: 'balanceEth', fieldType: 'number', description: 'Current ETH balance', required: true },
			{ name: 'belowThreshold', fieldType: 'boolean', description: 'True if alert', required: true },
		],
	},
]

// ─── Cache ────────────────────────────────────────────────────────────────────

export class WorkflowCache {
	private listings: Map<string, WorkflowListing> = new Map()
	private reader: RegistryReader
	private index: SearchIndex
	private refreshTimer: ReturnType<typeof setInterval> | undefined
	private _ready = false

	constructor(reader: RegistryReader, index: SearchIndex) {
		this.reader = reader
		this.index = index
	}

	// ── Startup ────────────────────────────────────────────────────────────────

	async start(refreshIntervalMs = 60_000): Promise<void> {
		await this._refresh()
		this.refreshTimer = setInterval(() => void this._refresh(), refreshIntervalMs)
		this._ready = true
	}

	stop(): void {
		if (this.refreshTimer) clearInterval(this.refreshTimer)
	}

	get ready(): boolean {
		return this._ready
	}

	// ── Manual seed (for testing) ──────────────────────────────────────────────

	async seed(listings: WorkflowListing[]): Promise<void> {
		await this._applyListings(listings)
		this._ready = true
	}

	// ── Read ───────────────────────────────────────────────────────────────────

	getAll(): WorkflowListing[] {
		return [...this.listings.values()].filter((l) => l.metadata.active)
	}

	getOne(workflowId: string): WorkflowListing | undefined {
		return this.listings.get(workflowId)
	}

	getIndex(): SearchIndex {
		return this.index
	}

	// ── Refresh ────────────────────────────────────────────────────────────────

	private async _refresh(): Promise<void> {
		let fresh: WorkflowListing[]

		if (this.reader.isConfigured) {
			try {
				fresh = await this.reader.fetchAll()
				console.log(`[cache] Synced ${fresh.length} listings from chain`)
			} catch (err) {
				console.error('[cache] Chain sync failed, keeping stale data:', err)
				return
			}
		} else {
			// Demo mode: use seed listings
			fresh = DEMO_LISTINGS
			console.log(`[cache] Using ${fresh.length} demo listings (WORKFLOW_REGISTRY_ADDRESS not set)`)
		}

		await this._applyListings(fresh)
	}

	private async _applyListings(listings: WorkflowListing[]): Promise<void> {
		this.listings.clear()
		for (const l of listings) {
			this.listings.set(l.metadata.workflowId, l)
		}

		// Rebuild semantic search index
		await this.index.rebuild(
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

		console.log(`[cache] Search index rebuilt (${this.index.size} entries)`)
	}
}
