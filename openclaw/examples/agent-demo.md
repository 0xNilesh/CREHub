# Openclaw Agent Demo — CREHub Marketplace

End-to-end example of an Openclaw agent discovering and paying for a CRE workflow.

## Scenario

> "Check the Aave health factor for wallet 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045"

---

## Step 1 — Agent searches marketplace

```
GET http://localhost:4000/api/workflows/search?q=aave+health+factor&limit=3
```

Response:
```json
[
  {
    "workflowId": "wf_hf_monitor_01",
    "score": 0.94,
    "pricePerInvocation": "10000",
    "description": "Returns the health factor for an Aave v3 lending position.",
    "inputs": [
      { "name": "walletAddress", "fieldType": "address", "required": true },
      { "name": "protocol",      "fieldType": "string",  "required": false }
    ],
    "outputs": [
      { "name": "healthFactor", "fieldType": "number" },
      { "name": "riskLevel",    "fieldType": "string" }
    ]
  }
]
```

Agent selects `wf_hf_monitor_01` (score 0.94, price $0.01).

---

## Step 2 — Agent attempts trigger (no payment)

```
POST http://localhost:4000/api/trigger/wf_hf_monitor_01
Content-Type: application/json

{ "walletAddress": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" }
```

Response **HTTP 402**:
```json
{
  "paymentDetails": {
    "network": "ethereum-sepolia",
    "chainId": 11155111,
    "payTo": "0xPLATFORM_WALLET",
    "amount": "10000",
    "token": "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"
  }
}
```

---

## Step 3 — Agent broadcasts USDC transfer

Agent calls `USDC.transfer("0xPLATFORM_WALLET", 10000)` on Ethereum Sepolia.

Transaction mined: `0x7f3a...c92b`

---

## Step 4 — Agent retries with payment proof

```
POST http://localhost:4000/api/trigger/wf_hf_monitor_01
Content-Type: application/json
X-Payment: 0x7f3a...c92b

{ "walletAddress": "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045" }
```

Response **HTTP 200**:
```json
{
  "success": true,
  "output": {
    "healthFactor": 2.4,
    "riskLevel": "safe"
  },
  "settlementTx": "0xabc1...def2"
}
```

---

## Step 5 — Agent logs result

```
Health factor: 2.4 — position SAFE
Paid: $0.01 USDC
Settlement: https://sepolia.etherscan.io/tx/0xabc1...def2
Creator earned: $0.009 USDC (90%)
Protocol fee:   $0.001 USDC (10%)
```

---

## Failure scenario

If the workflow fails (e.g. invalid address):

```json
{
  "success": false,
  "error": "Simulation failed: invalid EVM address",
  "settlementTx": "0xfail...tx"
}
```

Agent receives 99% refund ($0.0099 USDC) automatically via `SettlementVault.settleFailure()`.
