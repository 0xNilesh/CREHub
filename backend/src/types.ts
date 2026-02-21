import type { Hex } from 'viem'

// ─── On-chain types (mirrors WorkflowRegistry.sol structs) ───────────────────

export interface WorkflowIOField {
	name: string
	fieldType: string // "string" | "number" | "boolean" | "address"
	description: string
	required: boolean
}

export interface WorkflowMetadata {
	workflowId: string
	creatorAddress: Hex
	pricePerInvocation: bigint // USDC wei (6 decimals)
	description: string
	detailedDescription: string
	category: string
	active: boolean
	registeredAt: bigint
}

export interface WorkflowListing {
	metadata: WorkflowMetadata
	inputs: WorkflowIOField[]
	outputs: WorkflowIOField[]
}

// ─── API response shapes ──────────────────────────────────────────────────────

export interface WorkflowResponse {
	workflowId: string
	creatorAddress: string
	pricePerInvocation: string // string for JSON (bigint not serialisable)
	description: string
	detailedDescription: string
	category: string
	active: boolean
	registeredAt: string
	inputs: WorkflowIOField[]
	outputs: WorkflowIOField[]
}

export interface SearchResult extends WorkflowResponse {
	score: number // cosine similarity [0, 1]
}

// ─── Conversions ──────────────────────────────────────────────────────────────

export const toWorkflowResponse = (listing: WorkflowListing): WorkflowResponse => ({
	workflowId: listing.metadata.workflowId,
	creatorAddress: listing.metadata.creatorAddress,
	pricePerInvocation: listing.metadata.pricePerInvocation.toString(),
	description: listing.metadata.description,
	detailedDescription: listing.metadata.detailedDescription,
	category: listing.metadata.category,
	active: listing.metadata.active,
	registeredAt: listing.metadata.registeredAt.toString(),
	inputs: listing.inputs,
	outputs: listing.outputs,
})
