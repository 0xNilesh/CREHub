/**
 * SettlementClient implementations.
 *
 * LoggingSettlementClient  — for demo/dev: logs all actions, returns dummy tx hashes.
 * (Real contract client to be added once Phase 3 contracts are deployed.)
 */
import type { Hex } from 'viem'
import { randomBytes } from 'node:crypto'
import type { SettlementClient } from './types'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fakeTxHash = (): Hex => `0x${randomBytes(32).toString('hex')}`

// ─── LoggingSettlementClient ──────────────────────────────────────────────────
// Used for simulation-only demo. No contract interaction.

export class LoggingSettlementClient implements SettlementClient {
	private log(msg: string) {
		console.log(`[Settlement] ${msg}`)
	}

	async createEscrow(params: {
		workflowId: string
		agentAddress: Hex
		creatorAddress: Hex
		amount: bigint
		inputsJson: string
	}): Promise<Hex> {
		const executionId = `0x${randomBytes(32).toString('hex')}` as Hex
		this.log(`createEscrow executionId=${executionId}`)
		this.log(`  workflowId=${params.workflowId}`)
		this.log(`  agent=${params.agentAddress}`)
		this.log(`  creator=${params.creatorAddress}`)
		this.log(`  amount=${params.amount} USDC wei`)
		this.log(`  emit ExecutionTriggered(${executionId}, ${params.workflowId}, ${params.agentAddress})`)
		return executionId
	}

	async settleSuccess(params: { executionId: Hex; outputsJson: string }): Promise<Hex> {
		const txHash = fakeTxHash()
		this.log(`settleSuccess executionId=${params.executionId}`)
		this.log(`  outputs=${params.outputsJson}`)
		this.log(`  → 90% USDC to creator, 10% to treasury`)
		this.log(`  emit ExecutionSettled(success=true) txHash=${txHash}`)
		return txHash
	}

	async settleFailure(params: { executionId: Hex; errorMessage: string }): Promise<Hex> {
		const txHash = fakeTxHash()
		this.log(`settleFailure executionId=${params.executionId}`)
		this.log(`  error=${params.errorMessage}`)
		this.log(`  → 99% USDC refunded to agent, 1% to treasury`)
		this.log(`  emit ExecutionSettled(success=false) txHash=${txHash}`)
		return txHash
	}
}
