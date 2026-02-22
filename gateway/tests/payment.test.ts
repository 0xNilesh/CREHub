/**
 * Phase 2 – payment.ts tests
 *
 * Tests verifyUSDCTransfer (pure) and the 402/200 middleware flow (mocked viem client).
 */
import { describe, expect, test, beforeEach } from 'bun:test'
import { verifyUSDCTransfer, USDC_ADDRESS, setPublicClient } from '../src/payment'
import type { TransactionReceipt, Log, Hex } from 'viem'
import { encodeEventTopics, parseAbi, keccak256, toHex, padHex, numberToHex } from 'viem'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TRANSFER_TOPIC = keccak256(toHex('Transfer(address,address,uint256)'))

const makePaddedAddress = (addr: string): Hex => padHex(addr as Hex, { size: 32 })

const makeTransferLog = (from: string, to: string, value: bigint): Log => {
	const fromPadded = makePaddedAddress(from)
	const toPadded = makePaddedAddress(to)
	// Encode value as 32-byte big-endian hex
	const valueHex = `0x${value.toString(16).padStart(64, '0')}` as Hex

	return {
		address: USDC_ADDRESS,
		topics: [TRANSFER_TOPIC as Hex, fromPadded, toPadded],
		data: valueHex,
		blockNumber: 1n,
		blockHash: '0x0',
		transactionHash: '0x0',
		transactionIndex: 0,
		logIndex: 0,
		removed: false,
	} as unknown as Log
}

const makeReceipt = (logs: Log[], status: 'success' | 'reverted' = 'success'): TransactionReceipt =>
	({
		status,
		logs,
	}) as unknown as TransactionReceipt

const PLATFORM_WALLET = '0xf39Fd6e51aad88F6f4ce6aB8827279cffFb92266'
const AGENT_WALLET = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const PRICE = 10_000n // $0.01 USDC

// ─── verifyUSDCTransfer ───────────────────────────────────────────────────────

describe('verifyUSDCTransfer', () => {
	test('returns valid=true for a matching Transfer log', () => {
		const log = makeTransferLog(AGENT_WALLET, PLATFORM_WALLET, PRICE)
		const receipt = makeReceipt([log])
		const result = verifyUSDCTransfer(receipt, PLATFORM_WALLET, PRICE)
		expect(result.valid).toBe(true)
		expect(result.from?.toLowerCase()).toBe(AGENT_WALLET.toLowerCase())
	})

	test('returns valid=true when amount exceeds required price (overpayment)', () => {
		const log = makeTransferLog(AGENT_WALLET, PLATFORM_WALLET, PRICE * 2n)
		const receipt = makeReceipt([log])
		const result = verifyUSDCTransfer(receipt, PLATFORM_WALLET, PRICE)
		expect(result.valid).toBe(true)
	})

	test('returns valid=false when amount is less than required', () => {
		const log = makeTransferLog(AGENT_WALLET, PLATFORM_WALLET, PRICE - 1n)
		const receipt = makeReceipt([log])
		const result = verifyUSDCTransfer(receipt, PLATFORM_WALLET, PRICE)
		expect(result.valid).toBe(false)
	})

	test('returns valid=false when `to` address does not match platform wallet', () => {
		const wrongWallet = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC'
		const log = makeTransferLog(AGENT_WALLET, wrongWallet, PRICE)
		const receipt = makeReceipt([log])
		const result = verifyUSDCTransfer(receipt, PLATFORM_WALLET, PRICE)
		expect(result.valid).toBe(false)
	})

	test('returns valid=false when transaction reverted', () => {
		const log = makeTransferLog(AGENT_WALLET, PLATFORM_WALLET, PRICE)
		const receipt = makeReceipt([log], 'reverted')
		const result = verifyUSDCTransfer(receipt, PLATFORM_WALLET, PRICE)
		expect(result.valid).toBe(false)
		expect(result.error).toBe('Transaction reverted')
	})

	test('returns valid=false when logs are empty', () => {
		const receipt = makeReceipt([])
		const result = verifyUSDCTransfer(receipt, PLATFORM_WALLET, PRICE)
		expect(result.valid).toBe(false)
	})

	test('ignores logs from other contracts (not USDC)', () => {
		const log: Log = {
			...makeTransferLog(AGENT_WALLET, PLATFORM_WALLET, PRICE),
			address: '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef' as Hex,
		}
		const receipt = makeReceipt([log])
		const result = verifyUSDCTransfer(receipt, PLATFORM_WALLET, PRICE)
		expect(result.valid).toBe(false)
	})

	test('finds the matching log among multiple logs', () => {
		const nonUSDCLog: Log = {
			...makeTransferLog(AGENT_WALLET, PLATFORM_WALLET, PRICE),
			address: '0xdeadbeef00000000000000000000000000000000' as Hex,
		}
		const correctLog = makeTransferLog(AGENT_WALLET, PLATFORM_WALLET, PRICE)
		const receipt = makeReceipt([nonUSDCLog, correctLog])
		const result = verifyUSDCTransfer(receipt, PLATFORM_WALLET, PRICE)
		expect(result.valid).toBe(true)
	})

	test('address comparison is case-insensitive', () => {
		const log = makeTransferLog(AGENT_WALLET, PLATFORM_WALLET.toLowerCase(), PRICE)
		const receipt = makeReceipt([log])
		const result = verifyUSDCTransfer(receipt, PLATFORM_WALLET.toUpperCase(), PRICE)
		expect(result.valid).toBe(true)
	})
})

// ─── holdAndExecute (integration, mocked settlement + simulate) ───────────────

describe('holdAndExecute', () => {
	test('on simulate success: calls createEscrow then settleSuccess', async () => {
		const { holdAndExecute } = await import('../src/payment')

		const calls: string[] = []
		const mockSettlement = {
			createEscrow: async () => {
				calls.push('createEscrow')
				return '0xexecutionId' as Hex
			},
			settleSuccess: async () => {
				calls.push('settleSuccess')
				return '0xsuccessTx' as Hex
			},
			settleFailure: async () => {
				calls.push('settleFailure')
				return '0xfailureTx' as Hex
			},
		}

		const mockSimulate = async () => ({
			success: true,
			output: { healthFactor: 2.4, riskLevel: 'safe' },
			logs: [],
		})

		const result = await holdAndExecute({
			workflowId: 'wf_test',
			workflowDir: '/tmp/fake',
			agentAddress: AGENT_WALLET as Hex,
			creatorAddress: PLATFORM_WALLET as Hex,
			amount: PRICE,
			input: { walletAddress: AGENT_WALLET },
			paymentTxHash: '0xpaymenttx',
			settlement: mockSettlement,
			simulate: mockSimulate,
			dbSave: async () => {},
			dbSettle: async () => {},
		})

		expect(calls).toContain('createEscrow')
		expect(calls).toContain('settleSuccess')
		expect(calls).not.toContain('settleFailure')
		expect(result.success).toBe(true)
		expect(result.output).toEqual({ healthFactor: 2.4, riskLevel: 'safe' })
		expect(result.settlementTx).toBe('0xsuccessTx')
	})

	test('on simulate failure: calls createEscrow then settleFailure', async () => {
		const { holdAndExecute } = await import('../src/payment')

		const calls: string[] = []
		const mockSettlement = {
			createEscrow: async () => {
				calls.push('createEscrow')
				return '0xexecutionId' as Hex
			},
			settleSuccess: async () => {
				calls.push('settleSuccess')
				return '0xsuccessTx' as Hex
			},
			settleFailure: async () => {
				calls.push('settleFailure')
				return '0xfailureTx' as Hex
			},
		}

		const mockSimulate = async () => ({
			success: false,
			output: null,
			error: 'handler threw an exception',
			logs: [],
		})

		const result = await holdAndExecute({
			workflowId: 'wf_test',
			workflowDir: '/tmp/fake',
			agentAddress: AGENT_WALLET as Hex,
			creatorAddress: PLATFORM_WALLET as Hex,
			amount: PRICE,
			input: {},
			paymentTxHash: '0xpaymenttx',
			settlement: mockSettlement,
			simulate: mockSimulate,
			dbSave: async () => {},
			dbSettle: async () => {},
		})

		expect(calls).toContain('createEscrow')
		expect(calls).toContain('settleFailure')
		expect(calls).not.toContain('settleSuccess')
		expect(result.success).toBe(false)
		expect(result.error).toBe('handler threw an exception')
		expect(result.settlementTx).toBe('0xfailureTx')
	})
})
