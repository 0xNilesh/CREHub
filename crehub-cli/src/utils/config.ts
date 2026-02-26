/**
 * Global CREHub CLI config stored at ~/.crehub/config.json
 *
 * Keys:
 *   gatewayPublicKey   — CREHub gateway public key (fixed per deployment)
 *   registryAddress    — WorkflowRegistry contract address on Sepolia
 *   rpcUrl             — Ethereum Sepolia RPC URL
 *   privateKey         — Developer's wallet private key (for on-chain listing)
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const CONFIG_DIR       = join(homedir(), '.crehub')
export const CONFIG_FILE = join(CONFIG_DIR, 'config.json')

// CREHub platform defaults (can be overridden per-project in .env)
export const PLATFORM_DEFAULTS = {
  gatewayPublicKey:  '0xFBDf4Dc13ed423C1E534Da0b2ed229B6a376a31f',
  registryAddress:   '0x76DdB79B8912ba34959809b9a64B435477BE13C0',
  rpcUrl:            'https://ethereum-sepolia-rpc.publicnode.com',
}

export interface CrehubConfig {
  gatewayPublicKey?: string
  registryAddress?:  string
  rpcUrl?:           string
  privateKey?:       string
}

export const readConfig = (): CrehubConfig => {
  if (!existsSync(CONFIG_FILE)) return {}
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'))
  } catch {
    return {}
  }
}

export const writeConfig = (cfg: CrehubConfig): void => {
  mkdirSync(CONFIG_DIR, { recursive: true })
  writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2) + '\n', 'utf8')
}

export const getConfig = (): Required<Omit<CrehubConfig, 'privateKey'>> & CrehubConfig => {
  const stored = readConfig()
  return {
    gatewayPublicKey: stored.gatewayPublicKey ?? PLATFORM_DEFAULTS.gatewayPublicKey,
    registryAddress:  stored.registryAddress  ?? PLATFORM_DEFAULTS.registryAddress,
    rpcUrl:           stored.rpcUrl           ?? PLATFORM_DEFAULTS.rpcUrl,
    privateKey:       stored.privateKey,
  }
}

export const setConfigKey = (key: string, value: string): void => {
  const cfg = readConfig()
  ;(cfg as Record<string, string>)[key] = value
  writeConfig(cfg)
}

export const getConfigKey = (key: string): string | undefined => {
  return (readConfig() as Record<string, string>)[key]
}
