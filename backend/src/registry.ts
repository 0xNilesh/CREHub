/**
 * WorkflowRegistry on-chain reader.
 *
 * Reads workflow listings from WorkflowRegistry.sol deployed on Ethereum Sepolia.
 * Falls back to an empty list (with a warning) when WORKFLOW_REGISTRY_ADDRESS
 * is not configured — the cache module then uses seed demo data instead.
 */
import { createPublicClient, http, parseAbi, type PublicClient, type Hex } from 'viem'
import { sepolia } from 'viem/chains'
import type { WorkflowListing } from './types'

// ─── ABI (key read functions only) ───────────────────────────────────────────

export const REGISTRY_ABI = parseAbi([
	'function getAllWorkflowIds() view returns (string[])',
	'function getWorkflow(string workflowId) view returns ((string workflowId, address creatorAddress, uint256 pricePerInvocation, string description, string detailedDescription, string category, bool active, uint256 registeredAt) metadata, (string name, string fieldType, string description, bool required)[] inputs, (string name, string fieldType, string description, bool required)[] outputs)',
	'function getActiveWorkflows(uint256 offset, uint256 limit) view returns ((string workflowId, address creatorAddress, uint256 pricePerInvocation, string description, string detailedDescription, string category, bool active, uint256 registeredAt)[])',
	'function totalWorkflows() view returns (uint256)',
])

// ─── Client (injectable for testing) ─────────────────────────────────────────

let _client: PublicClient | undefined

export const getClient = (): PublicClient => {
	if (!_client) {
		_client = createPublicClient({
			chain: sepolia,
			transport: http(
				process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com',
			),
		})
	}
	return _client
}

export const setClient = (client: PublicClient) => {
	_client = client
}

// ─── RegistryReader ───────────────────────────────────────────────────────────

export class RegistryReader {
	private address: Hex | undefined

	constructor(address?: string) {
		this.address = address ? (address as Hex) : undefined
	}

	get isConfigured(): boolean {
		return !!this.address
	}

	/** Fetch all active workflow listings from chain. */
	async fetchAll(): Promise<WorkflowListing[]> {
		if (!this.address) return []

		const client = getClient()

		// Get all IDs first, then fetch details in parallel (batched for safety)
		const ids = await client.readContract({
			address: this.address,
			abi: REGISTRY_ABI,
			functionName: 'getAllWorkflowIds',
		})

		if (ids.length === 0) return []

		const listings = await Promise.all(
			ids.map(async (id: string) => {
				const [metadata, inputs, outputs] = await client.readContract({
					address: this.address!,
					abi: REGISTRY_ABI,
					functionName: 'getWorkflow',
					args: [id],
				})
				return { metadata, inputs, outputs } as WorkflowListing
			}),
		)

		return listings.filter((l) => l.metadata.active)
	}

	/** Fetch a single workflow by ID. */
	async fetchOne(workflowId: string): Promise<WorkflowListing | null> {
		if (!this.address) return null

		try {
			const client = getClient()
			const [metadata, inputs, outputs] = await client.readContract({
				address: this.address,
				abi: REGISTRY_ABI,
				functionName: 'getWorkflow',
				args: [workflowId],
			})
			return { metadata, inputs, outputs } as WorkflowListing
		} catch {
			return null
		}
	}
}
