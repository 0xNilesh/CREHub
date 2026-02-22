/**
 * Ethereum Sepolia USDC payment verifier.
 *
 * The x402 SDK only supports Base/Base-Sepolia natively. For Ethereum Sepolia
 * we implement a lightweight manual verifier:
 *   1. If no X-PAYMENT header → return 402 with paymentDetails.
 *   2. If X-PAYMENT header present → fetch tx receipt via viem, verify
 *      there is a USDC Transfer log to PLATFORM_WALLET for >= pricePerInvocation.
 *   3. On success, propagate agentAddress for downstream escrow creation.
 */
import type { Request, Response, NextFunction } from 'express'
import {
	createPublicClient,
	http,
	type Hex,
	type PublicClient,
	type TransactionReceipt,
	decodeEventLog,
	parseAbi,
	getAddress,
} from 'viem'
import { sepolia } from 'viem/chains'
import type { PaymentDetails, SettlementClient, SimulateResult, ExecutionResult } from './types'
import { runSimulate } from './simulate'

// ─── Constants ────────────────────────────────────────────────────────────────

export const USDC_ADDRESS = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238' as const

export const USDC_TRANSFER_ABI = parseAbi([
	'event Transfer(address indexed from, address indexed to, uint256 value)',
])

// ─── Public client (injectable for testing) ───────────────────────────────────

let _publicClient: PublicClient | undefined

export const getPublicClient = (): PublicClient => {
	if (!_publicClient) {
		_publicClient = createPublicClient({
			chain: sepolia,
			transport: http(
				process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com',
			),
		})
	}
	return _publicClient
}

export const setPublicClient = (client: PublicClient) => {
	_publicClient = client
}

// ─── USDC Transfer verification ───────────────────────────────────────────────

export interface TransferVerification {
	valid: boolean
	from?: Hex
	error?: string
}

export const verifyUSDCTransfer = (
	receipt: TransactionReceipt,
	expectedTo: string,
	requiredAmount: bigint,
): TransferVerification => {
	if (receipt.status !== 'success') {
		return { valid: false, error: 'Transaction reverted' }
	}

	for (const log of receipt.logs) {
		if (log.address.toLowerCase() !== USDC_ADDRESS.toLowerCase()) continue

		try {
			const decoded = decodeEventLog({
				abi: USDC_TRANSFER_ABI,
				data: log.data,
				topics: log.topics as [Hex, ...Hex[]],
			})

			if (decoded.eventName !== 'Transfer') continue

			const toMatch =
				getAddress(decoded.args.to as string).toLowerCase() === expectedTo.toLowerCase()
			const amountOk = (decoded.args.value as bigint) >= requiredAmount

			if (toMatch && amountOk) {
				return { valid: true, from: decoded.args.from as Hex }
			}
		} catch {
			// not a Transfer log — skip
		}
	}

	return { valid: false, error: 'No matching USDC Transfer log found' }
}

// ─── Express middleware ───────────────────────────────────────────────────────

export interface PaymentVerifiedRequest extends Request {
	agentAddress?: Hex
	workflowPrice?: bigint
}

export const createPaymentMiddleware = (
	getWorkflowPrice: (workflowId: string) => bigint | Promise<bigint>,
) => {
	return async (req: PaymentVerifiedRequest, res: Response, next: NextFunction) => {
		const workflowId = req.params.workflowId
		const txHash = req.headers['x-payment'] as string | undefined
		const price = await getWorkflowPrice(workflowId)
		const platformWallet = process.env.PLATFORM_WALLET!

		if (!txHash) {
			const paymentDetails: PaymentDetails = {
				network: 'ethereum-sepolia',
				chainId: 11155111,
				payTo: platformWallet,
				amount: price.toString(),
				token: USDC_ADDRESS,
			}
			return res.status(402).json({ error: 'Payment required', paymentDetails })
		}

		try {
			const client = getPublicClient()
			const receipt = await client.getTransactionReceipt({ hash: txHash as Hex })
			const verification = verifyUSDCTransfer(receipt, platformWallet, price)

			if (!verification.valid) {
				return res.status(402).json({ error: verification.error })
			}

			req.agentAddress = verification.from
			req.workflowPrice = price
			next()
		} catch (err) {
			const msg = err instanceof Error ? err.message : 'Unknown error'
			return res.status(402).json({ error: `Payment verification failed: ${msg}` })
		}
	}
}

// ─── holdAndExecute ───────────────────────────────────────────────────────────
// After payment verified: escrow → simulate → settle

export const holdAndExecute = async (params: {
	workflowId: string
	workflowDir: string
	agentAddress: Hex
	creatorAddress: Hex
	amount: bigint
	input: unknown
	settlement: SettlementClient
	simulate?: typeof runSimulate
}): Promise<ExecutionResult> => {
	const {
		workflowId,
		workflowDir,
		agentAddress,
		creatorAddress,
		amount,
		input,
		settlement,
		simulate = runSimulate,
	} = params

	const inputsJson = JSON.stringify(input)

	// 1. Create on-chain escrow (emits ExecutionTriggered — explorer shows "pending")
	const executionId = await settlement.createEscrow({
		workflowId,
		agentAddress,
		creatorAddress,
		amount,
		inputsJson,
	})

	// 2. Run `cre workflow simulate`
	let simulateResult: SimulateResult
	try {
		simulateResult = await simulate(workflowDir, input)
	} catch (err) {
		const errorMessage = err instanceof Error ? err.message : 'Simulation process error'
		const tx = await settlement.settleFailure({ executionId, errorMessage })
		return { success: false, output: null, error: errorMessage, settlementTx: tx }
	}

	// 3. Settle on-chain (emits ExecutionSettled — explorer shows final state)
	if (simulateResult.success) {
		const tx = await settlement.settleSuccess({
			executionId,
			outputsJson: JSON.stringify(simulateResult.output),
		})
		return { success: true, output: simulateResult.output, settlementTx: tx }
	} else {
		const errorMessage = simulateResult.error ?? 'simulation failed'
		const tx = await settlement.settleFailure({ executionId, errorMessage })
		return { success: false, output: null, error: errorMessage, settlementTx: tx }
	}
}
