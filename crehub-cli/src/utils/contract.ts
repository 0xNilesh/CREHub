/**
 * Viem helpers for WorkflowRegistry interactions.
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Hex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { sepolia } from 'viem/chains'
import { getConfig } from './config.ts'

const REGISTRY_ABI = parseAbi([
  'function listWorkflow(string workflowId, address creatorAddress, uint256 price, string description, string detailedDescription, string category, (string name, string fieldType, string description, bool required)[] inputs, (string name, string fieldType, string description, bool required)[] outputs) external',
  'function getAllWorkflowIds() view returns (string[])',
])

export const getPublicClient = () => {
  const { rpcUrl } = getConfig()
  return createPublicClient({ chain: sepolia, transport: http(rpcUrl) })
}

export const workflowExists = async (workflowId: string): Promise<boolean> => {
  const { registryAddress } = getConfig()
  const client = getPublicClient()
  try {
    const ids = await client.readContract({
      address: registryAddress as Hex,
      abi: REGISTRY_ABI,
      functionName: 'getAllWorkflowIds',
    }) as string[]
    return ids.includes(workflowId)
  } catch {
    return false
  }
}

export interface IOField {
  name: string
  fieldType: string
  description: string
  required: boolean
}

export const registerWorkflow = async (params: {
  workflowId:          string
  price:               bigint
  description:         string
  detailedDescription: string
  category:            string
  inputs:              IOField[]
  outputs:             IOField[]
  privateKey:          string
}): Promise<Hex> => {
  const { registryAddress, rpcUrl } = getConfig()
  const account = privateKeyToAccount(params.privateKey as Hex)
  const walletClient = createWalletClient({ account, chain: sepolia, transport: http(rpcUrl) })

  return walletClient.writeContract({
    address: registryAddress as Hex,
    abi: REGISTRY_ABI,
    functionName: 'listWorkflow',
    args: [
      params.workflowId,
      account.address,
      params.price,
      params.description,
      params.detailedDescription,
      params.category,
      params.inputs as any,
      params.outputs as any,
    ],
  })
}

export const waitForTx = async (hash: Hex) => {
  const client = getPublicClient()
  return client.waitForTransactionReceipt({ hash })
}
