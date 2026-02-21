import type { Hex } from 'viem'

// ─── Workflow Metadata ────────────────────────────────────────────────────────

export interface WorkflowIOField {
	name: string
	type: 'string' | 'number' | 'boolean' | 'address'
	description: string
	required: boolean
}

export interface WorkflowMetadata {
	workflowId: string
	creatorAddress: Hex
	pricePerInvocation: string // USDC in wei (6 decimals), e.g. "10000" = $0.01
	description: string // ≤ 160 chars
	detailedDescription: string
	inputs: WorkflowIOField[]
	outputs: WorkflowIOField[]
	category: 'defi' | 'monitoring' | 'data' | 'compute'
	active: boolean
	workflowDir: string // server-side absolute path to the workflow directory
}

// ─── Payment ──────────────────────────────────────────────────────────────────

export interface PaymentDetails {
	network: 'ethereum-sepolia'
	chainId: 11155111
	payTo: string
	amount: string // USDC wei
	token: string // USDC contract address
}

export interface Payment402Response {
	error: 'Payment required'
	paymentDetails: PaymentDetails
}

// ─── Simulate ─────────────────────────────────────────────────────────────────

export interface SimulateResult {
	success: boolean
	output: unknown // parsed workflow output (null on failure)
	error?: string // error message if failed
	logs: string[] // raw cre simulate stdout lines
}

// ─── Execution ────────────────────────────────────────────────────────────────

export interface ExecutionResult {
	success: boolean
	output: unknown
	settlementTx?: string
	error?: string
}

// ─── Settlement Vault Client ──────────────────────────────────────────────────
// Interface so we can swap in a mock during testing / before contracts deploy.

export interface SettlementClient {
	createEscrow(params: {
		workflowId: string
		agentAddress: Hex
		creatorAddress: Hex
		amount: bigint
		inputsJson: string
	}): Promise<Hex> // returns executionId

	settleSuccess(params: { executionId: Hex; outputsJson: string }): Promise<Hex> // returns tx hash

	settleFailure(params: { executionId: Hex; errorMessage: string }): Promise<Hex> // returns tx hash
}
