/**
 * on-chain-result.ts
 *
 * After a successful `cre workflow simulate`, call WorkflowResultStore.storeResult()
 * on Ethereum Sepolia to write a keccak256 hash of the output JSON on-chain.
 *
 * This gives every CREHub execution a verifiable Sepolia tx hash — proof that
 * the CRE workflow ran — even before full DON deploy access is available.
 *
 * Verify on Etherscan Sepolia:
 *   https://sepolia.etherscan.io/address/0xD4CE3309d05426446f3E778Dd294F00beBf3A12a
 */
import {
	createPublicClient,
	createWalletClient,
	http,
	parseAbi,
	keccak256,
	toBytes,
	type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'

// ─── ABI ─────────────────────────────────────────────────────────────────────

const STORE_ABI = parseAbi([
	'function storeResult(string workflowId, bytes32 resultHash) external',
	'event ResultStored(string indexed workflowId, bytes32 resultHash, address indexed executor, uint256 timestamp)',
])

// ─── Lazy clients (only init if RESULT_STORE_ADDRESS is set) ─────────────────

let _wallet: ReturnType<typeof createWalletClient> | null = null
let _pub:    ReturnType<typeof createPublicClient>  | null = null

function getClients() {
	if (!_wallet || !_pub) {
		const pk = process.env.GATEWAY_PRIVATE_KEY as Hex
		const rpc = process.env.SEPOLIA_RPC_URL ?? 'https://ethereum-sepolia-rpc.publicnode.com'
		const account = privateKeyToAccount(pk)
		const transport = http(rpc)
		_wallet = createWalletClient({ account, chain: sepolia, transport })
		_pub    = createPublicClient({ chain: sepolia, transport })
	}
	return { wallet: _wallet, pub: _pub }
}

// ─── writeOnChain ─────────────────────────────────────────────────────────────

/**
 * Writes keccak256(resultJson) to WorkflowResultStore on Sepolia.
 * Returns the tx hash, or null if RESULT_STORE_ADDRESS is not configured.
 */
export async function writeOnChain(
	workflowId: string,
	output: unknown,
): Promise<Hex | null> {
	const storeAddr = process.env.RESULT_STORE_ADDRESS as Hex | undefined
	if (!storeAddr) return null

	try {
		const resultJson = JSON.stringify(output)
		const resultHash = keccak256(toBytes(resultJson))

		const { wallet, pub } = getClients()
		const account = (wallet as any).account

		const txHash = await wallet.writeContract({
			address:      storeAddr,
			abi:          STORE_ABI,
			functionName: 'storeResult',
			args:         [workflowId, resultHash],
			account,
			chain:        sepolia,
		})

		console.log(`[onchain] storeResult workflowId=${workflowId} resultHash=${resultHash}`)
		console.log(`[onchain] tx broadcast: ${txHash}`)

		await pub.waitForTransactionReceipt({ hash: txHash, confirmations: 1 })
		console.log(`[onchain] confirmed: ${txHash}`)

		return txHash
	} catch (err) {
		// Non-fatal — simulation result is still returned to the agent
		console.error(`[onchain] writeOnChain failed (non-fatal): ${err instanceof Error ? err.message : err}`)
		return null
	}
}
