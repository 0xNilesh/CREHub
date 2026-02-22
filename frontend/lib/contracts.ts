import config from '../../config.json'

export const REGISTRY_ADDRESS = config.contracts.WorkflowRegistry as `0x${string}`

export const REGISTRY_ABI = [
  {
    type: 'function',
    name: 'listWorkflow',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'workflowId',          type: 'string' },
      { name: 'price',               type: 'uint256' },
      { name: 'description',         type: 'string' },
      { name: 'detailedDescription', type: 'string' },
      { name: 'category',            type: 'string' },
      {
        name: 'inputs', type: 'tuple[]',
        components: [
          { name: 'name',        type: 'string' },
          { name: 'fieldType',   type: 'string' },
          { name: 'description', type: 'string' },
          { name: 'required',    type: 'bool'   },
        ],
      },
      {
        name: 'outputs', type: 'tuple[]',
        components: [
          { name: 'name',        type: 'string' },
          { name: 'fieldType',   type: 'string' },
          { name: 'description', type: 'string' },
          { name: 'required',    type: 'bool'   },
        ],
      },
    ],
    outputs: [],
  },
] as const
