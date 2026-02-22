/**
 * Sample Chainlink Price Feed data for local-simulation mode.
 *
 * In production these values would be fetched on-chain via the
 * Chainlink AggregatorV3Interface:
 *   latestRoundData() → (roundId, answer, startedAt, updatedAt, answeredInRound)
 *
 * Each price represents the USD value of 1 unit of the asset.
 */

export interface PriceFeed {
	asset: string
	priceUsd: number
	/** Chainlink feed address on Ethereum mainnet (informational) */
	feedAddress: string
}

export const CHAINLINK_PRICES: Record<string, PriceFeed> = {
	ETH: {
		asset: 'ETH',
		priceUsd: 2_400.0,
		feedAddress: '0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419',
	},
	WBTC: {
		asset: 'WBTC',
		priceUsd: 65_000.0,
		feedAddress: '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c',
	},
	USDC: {
		asset: 'USDC',
		priceUsd: 1.0,
		feedAddress: '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6',
	},
	DAI: {
		asset: 'DAI',
		priceUsd: 1.0,
		feedAddress: '0xAed0c38402a5d19df6E4c03F4E2DceD6e29c1ee9',
	},
	LINK: {
		asset: 'LINK',
		priceUsd: 18.5,
		feedAddress: '0x2c1d072e956AFFC0D435Cb7AC38EF18d24d9127c',
	},
	WSTETH: {
		asset: 'WSTETH',
		priceUsd: 2_820.0,
		feedAddress: '0x8770d8dEb4Bc923bf929cd260280B5F1dd69564D',
	},
}

export const getPriceUsd = (asset: string): number => {
	return CHAINLINK_PRICES[asset]?.priceUsd ?? 1.0
}
