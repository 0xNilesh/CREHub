/**
 * SettlementClient implementations.
 *
 * ContractSettlementClient — live Sepolia calls to SettlementVault.sol.
 * LoggingSettlementClient  — fallback for dev/test: logs actions, fake hashes.
 */
import {
	createWalletClient,
	createPublicClient,
	http,
	parseAbi,
	decodeEventLog,
	type Hex,
	type PublicClient,
	type WalletClient,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'
import { randomBytes } from 'node:crypto'
import type { SettlementClient } from './types'

// ─── ABIs (inline from SettlementVault.sol + IERC20) ─────────────────────────

const VAULT_ABI = parseAbi([
	'function createEscrow(string workflowId, address agentAddress, address creatorAddress, uint256 amount, string inputsJson) external returns (bytes32)',
	'function settleSuccess(bytes32 executionId, string outputsJson) external',
	'function settleFailure(bytes32 executionId, string errorMessage) external',
	'event ExecutionTriggered(bytes32 indexed executionId, string indexed workflowId, address indexed agentAddress, address creatorAddress, uint256 pricePaid, string inputsJson, uint256 triggeredAt)',
])

const USDC_ABI = parseAbi([
	'function approve(address spender, uint256 amount) external returns (bool)',
	'function allowance(address owner, address spender) external view returns (uint256)',
])

// ─── ContractSettlementClient ─────────────────────────────────────────────────

export class ContractSettlementClient implements SettlementClient {
	private wallet: WalletClient & { account: ReturnType<typeof privateKeyToAccount> }
	private pub: PublicClient
	private vault: Hex
	private usdc: Hex

	constructor() {
		const account = privateKeyToAccount(process.env.GATEWAY_PRIVATE_KEY as Hex)
		const transport = http(process.env.SEPOLIA_RPC_URL)

		this.wallet = createWalletClient({ account, chain: sepolia, transport }) as any
		this.pub    = createPublicClient({ chain: sepolia, transport })
		this.vault  = process.env.SETTLEMENT_VAULT_ADDRESS as Hex
		this.usdc   = process.env.USDC_ADDRESS as Hex
	}

	/** Ensure vault has sufficient USDC allowance from gateway. One-time max approve. */
	private async ensureAllowance(needed: bigint): Promise<void> {
		const allowance = await this.pub.readContract({
			address: this.usdc,
			abi: USDC_ABI,
			functionName: 'allowance',
			args: [this.wallet.account.address, this.vault],
		})
		if (allowance < needed) {
			console.log('[Settlement] Approving USDC allowance for SettlementVault...')
			const txHash = await this.wallet.writeContract({
				address: this.usdc,
				abi: USDC_ABI,
				functionName: 'approve',
				args: [this.vault, BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')],
			})
			await this.pub.waitForTransactionReceipt({ hash: txHash })
			console.log(`[Settlement] USDC approval confirmed txHash=${txHash}`)
		}
	}

	async createEscrow(params: {
		workflowId: string
		agentAddress: Hex
		creatorAddress: Hex
		amount: bigint
		inputsJson: string
	}): Promise<Hex> {
		const txHash = await this.wallet.writeContract({
			address: this.vault,
			abi: VAULT_ABI,
			functionName: 'createEscrow',
			args: [params.workflowId, params.agentAddress, params.creatorAddress, params.amount, params.inputsJson],
		})

		const receipt = await this.pub.waitForTransactionReceipt({ hash: txHash })

		// Parse ExecutionTriggered to extract the on-chain executionId
		for (const log of receipt.logs) {
			try {
				const decoded = decodeEventLog({ abi: VAULT_ABI, data: log.data, topics: log.topics as any })
				if (decoded.eventName === 'ExecutionTriggered') {
					const executionId = decoded.args.executionId as Hex
					console.log(`[Settlement] createEscrow executionId=${executionId} txHash=${txHash}`)
					return executionId
				}
			} catch { /* not this event */ }
		}

		throw new Error(`ExecutionTriggered event not found in receipt ${txHash}`)
	}

	async settleSuccess(params: { executionId: Hex; outputsJson: string }): Promise<Hex> {
		await this.ensureAllowance(BigInt('1000000000')) // 1000 USDC headroom
		const txHash = await this.wallet.writeContract({
			address: this.vault,
			abi: VAULT_ABI,
			functionName: 'settleSuccess',
			args: [params.executionId, params.outputsJson],
		})
		await this.pub.waitForTransactionReceipt({ hash: txHash })
		console.log(`[Settlement] settleSuccess executionId=${params.executionId} txHash=${txHash}`)
		return txHash
	}

	async settleFailure(params: { executionId: Hex; errorMessage: string }): Promise<Hex> {
		await this.ensureAllowance(BigInt('1000000000'))
		const txHash = await this.wallet.writeContract({
			address: this.vault,
			abi: VAULT_ABI,
			functionName: 'settleFailure',
			args: [params.executionId, params.errorMessage],
		})
		await this.pub.waitForTransactionReceipt({ hash: txHash })
		console.log(`[Settlement] settleFailure executionId=${params.executionId} txHash=${txHash}`)
		return txHash
	}
}

// ─── LoggingSettlementClient ──────────────────────────────────────────────────
// Fallback when SETTLEMENT_VAULT_ADDRESS is not set (dev/test).

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
		const txHash = `0x${randomBytes(32).toString('hex')}` as Hex
		this.log(`settleSuccess executionId=${params.executionId}`)
		this.log(`  outputs=${params.outputsJson}`)
		this.log(`  → 90% USDC to creator, 10% to treasury`)
		this.log(`  emit ExecutionSettled(success=true) txHash=${txHash}`)
		return txHash
	}

	async settleFailure(params: { executionId: Hex; errorMessage: string }): Promise<Hex> {
		const txHash = `0x${randomBytes(32).toString('hex')}` as Hex
		this.log(`settleFailure executionId=${params.executionId}`)
		this.log(`  error=${params.errorMessage}`)
		this.log(`  → 99% USDC refunded to agent, 1% to treasury`)
		this.log(`  emit ExecutionSettled(success=false) txHash=${txHash}`)
		return txHash
	}
}
