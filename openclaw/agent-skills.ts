/**
 * CREHub Agent Skills — Wallet utilities for Ethereum Sepolia
 *
 * Provides USDC + ETH balance checks and USDC transfer for the main agent.
 * All operations are on Ethereum Sepolia (chainId 11155111).
 */
import {
	createPublicClient,
	createWalletClient,
	http,
	parseAbi,
	formatUnits,
	type Hex,
	type PublicClient,
	type WalletClient,
	type Account,
} from 'viem'
import { sepolia } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'

// ─── USDC ABI (minimal) ───────────────────────────────────────────────────────

export const USDC_ABI = parseAbi([
	'function balanceOf(address owner) view returns (uint256)',
	'function allowance(address owner, address spender) view returns (uint256)',
	'function approve(address spender, uint256 amount) returns (bool)',
	'function transfer(address to, uint256 amount) returns (bool)',
])

// ─── Client factory ───────────────────────────────────────────────────────────

export interface AgentClients {
	account: Account
	publicClient: PublicClient
	walletClient: WalletClient
}

export function createAgentClients(privateKey: Hex, rpcUrl: string): AgentClients {
	const account = privateKeyToAccount(privateKey)
	const transport = http(rpcUrl)
	const publicClient = createPublicClient({ chain: sepolia, transport })
	const walletClient = createWalletClient({ account, chain: sepolia, transport })
	return { account, publicClient, walletClient }
}

// ─── USDC balance ─────────────────────────────────────────────────────────────

export interface UsdcBalance {
	raw: bigint
	formatted: string  // e.g. "1.000000"
	usd: string        // e.g. "$1.0000"
}

export async function checkUsdcBalance(
	publicClient: PublicClient,
	usdcAddress: Hex,
	walletAddress: Hex,
): Promise<UsdcBalance> {
	const raw = (await publicClient.readContract({
		address: usdcAddress,
		abi: USDC_ABI,
		functionName: 'balanceOf',
		args: [walletAddress],
	})) as bigint
	const formatted = formatUnits(raw, 6)
	return {
		raw,
		formatted,
		usd: `$${Number(formatted).toFixed(4)}`,
	}
}

// ─── ETH balance ──────────────────────────────────────────────────────────────

export interface EthBalance {
	raw: bigint
	formatted: string  // e.g. "0.012345"
}

export async function checkEthBalance(
	publicClient: PublicClient,
	walletAddress: Hex,
): Promise<EthBalance> {
	const raw = await publicClient.getBalance({ address: walletAddress as Hex })
	const formatted = formatUnits(raw, 18)
	return { raw, formatted }
}

// ─── USDC transfer ────────────────────────────────────────────────────────────

/**
 * Broadcast a USDC transfer on Ethereum Sepolia and wait for 1 confirmation.
 * Returns the transaction hash.
 */
export async function sendUsdcTransfer(
	walletClient: WalletClient,
	publicClient: PublicClient,
	usdcAddress: Hex,
	to: Hex,
	amount: bigint,
): Promise<Hex> {
	const account = walletClient.account!
	const hash = await walletClient.writeContract({
		address: usdcAddress,
		abi: USDC_ABI,
		functionName: 'transfer',
		args: [to, amount],
		account,
		chain: sepolia,
	})
	await publicClient.waitForTransactionReceipt({ hash, confirmations: 1 })
	return hash
}

// ─── Format helpers ───────────────────────────────────────────────────────────

/** Convert USDC wei string (e.g. "10000") to human-readable (e.g. "$0.0100") */
export function formatUsdcWei(weiStr: string): string {
	const wei = BigInt(weiStr)
	const usd = Number(formatUnits(wei, 6))
	return `$${usd.toFixed(4)}`
}
