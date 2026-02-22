/**
 * Sample Aave V3 position dataset for local-simulation mode.
 *
 * In production these values are fetched on-chain via:
 *   IPool.getUserAccountData(user) → (totalCollateralBase, totalDebtBase,
 *     availableBorrowsBase, currentLiquidationThreshold, ltv, healthFactor)
 * or per-asset via:
 *   IPool.getReserveData(asset) + IERC20(aToken).balanceOf(user)
 *
 * Liquidation thresholds are Aave V3 Ethereum mainnet values (as of 2024).
 */

export interface CollateralPosition {
	asset: string
	amount: number
	/** Aave V3 liquidation threshold for this asset (e.g. 0.825 = 82.5%) */
	liquidationThreshold: number
}

export interface DebtPosition {
	asset: string
	amount: number
}

export interface AavePosition {
	collateral: CollateralPosition[]
	debt: DebtPosition[]
}

/**
 * Three demo wallets covering every risk tier, plus a default for unknown addresses.
 *
 * Wallet aliases used in tests and the sample payload:
 *   HEALTHY  — HF ~1.87  — safe
 *   WARNING  — HF ~1.15  — below alert threshold (1.2)
 *   CRITICAL — HF ~1.02  — below critical threshold (1.05)
 */
export const DEMO_WALLETS = {
	HEALTHY:  '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA01',
	WARNING:  '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA02',
	CRITICAL: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA03',
} as const

export const SAMPLE_POSITIONS: Record<string, AavePosition> = {
	// HF = (4800 × 0.825 + 6500 × 0.70) / 8000 = (3960 + 4550) / 8000 ≈ 1.064
	// Actually let me recalculate to get ~1.87:
	// Using ETH @ $2400 and WBTC @ $65000
	// Collateral: 2 ETH = $4800 liqThreshold=0.825 → weighted $3960
	//             0.1 WBTC = $6500 liqThreshold=0.70 → weighted $4550
	// Total weighted collateral = $8510
	// Debt: $4000 USDC + $500 DAI = $4500
	// HF = 8510 / 4500 ≈ 1.89 ✓
	[DEMO_WALLETS.HEALTHY]: {
		collateral: [
			{ asset: 'ETH',  amount: 2.0,  liquidationThreshold: 0.825 },
			{ asset: 'WBTC', amount: 0.1,  liquidationThreshold: 0.70 },
		],
		debt: [
			{ asset: 'USDC', amount: 4_000 },
			{ asset: 'DAI',  amount: 500 },
		],
	},

	// HF = (4800 × 0.825) / 4000 = 3960 / 3450 ≈ 1.147 (warning < 1.2)
	// Using 2 ETH @ $2400, debt $3450 USDC
	// HF = 3960 / 3450 ≈ 1.148 ✓
	[DEMO_WALLETS.WARNING]: {
		collateral: [
			{ asset: 'ETH', amount: 2.0, liquidationThreshold: 0.825 },
		],
		debt: [
			{ asset: 'USDC', amount: 3_450 },
		],
	},

	// HF = (2400 × 0.825) / 1940 = 1980 / 1940 ≈ 1.020 (critical < 1.05)
	[DEMO_WALLETS.CRITICAL]: {
		collateral: [
			{ asset: 'ETH', amount: 1.0, liquidationThreshold: 0.825 },
		],
		debt: [
			{ asset: 'USDC', amount: 1_940 },
		],
	},
}

/** Fallback position for unknown wallet addresses — moderate, safe position. */
export const DEFAULT_POSITION: AavePosition = {
	collateral: [
		{ asset: 'ETH',    amount: 1.5, liquidationThreshold: 0.825 },
		{ asset: 'WSTETH', amount: 0.5, liquidationThreshold: 0.80 },
	],
	debt: [
		{ asset: 'USDC', amount: 2_000 },
	],
}
