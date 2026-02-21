# x402 Payment Flow — Ethereum Sepolia USDC

CREHub uses the [x402 protocol](https://x402.org) for pay-per-trigger micropayments.
Payment token: **USDC** on **Ethereum Sepolia** (chainId `11155111`).

---

## Step-by-step

### Step 1 — Attempt trigger (no payment)

```
POST http://localhost:4000/api/trigger/:workflowId
Content-Type: application/json

{ "walletAddress": "0xYour...", "protocol": "aave" }
```

**Expected response: HTTP 402**

```json
{
  "paymentDetails": {
    "network": "ethereum-sepolia",
    "chainId": 11155111,
    "payTo": "0xPLATFORM_WALLET_ADDRESS",
    "amount": "10000",
    "token": "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"
  }
}
```

Extract:
- `payTo` — recipient of USDC transfer
- `amount` — USDC wei to send (e.g. `10000` = $0.01)
- `token` — USDC contract address on Sepolia

---

### Step 2 — Broadcast USDC transfer on Ethereum Sepolia

Call `transfer(address to, uint256 amount)` on the USDC contract:

| Field | Value |
|-------|-------|
| USDC contract | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` |
| Network | Ethereum Sepolia (chainId `11155111`) |
| RPC | `https://ethereum-sepolia-rpc.publicnode.com` |
| Function | `transfer(payTo, amount)` |
| Signer | Agent's Ethereum wallet (must hold Sepolia USDC + ETH for gas) |

**Sepolia USDC faucet:** https://faucet.circle.com
**Sepolia ETH faucet:** https://sepoliafaucet.com

Wait for the transaction to be mined (1 confirmation is sufficient).

---

### Step 3 — Retry trigger with payment proof

```
POST http://localhost:4000/api/trigger/:workflowId
Content-Type: application/json
X-Payment: <tx_hash_from_step_2>

{ "walletAddress": "0xYour...", "protocol": "aave" }
```

The gateway verifies the USDC `Transfer` event on-chain:
- `to` == `payTo`
- `value` >= `amount`
- Transaction is confirmed on Ethereum Sepolia

---

### Step 4 — Parse result

**Success (HTTP 200):**
```json
{
  "success": true,
  "output": {
    "healthFactor": 2.4,
    "riskLevel": "safe"
  },
  "settlementTx": "0xabc123..."
}
```

Read `output` using the workflow's `outputs[].name` field list.

**Failure (HTTP 200 with success=false):**
```json
{
  "success": false,
  "error": "Simulation failed: invalid address",
  "settlementTx": "0xdef456..."
}
```

On failure: **99%** of the payment is automatically refunded to the agent wallet
by `SettlementVault.settleFailure()` on Ethereum Sepolia.

---

## Fee Split

| Outcome | Creator | Protocol | Agent refund |
|---------|---------|----------|--------------|
| Success | 90% | 10% | 0% |
| Failure | 0% | 1% | 99% |

---

## Verification

All settlements are recorded on-chain. Use the `settlementTx` hash to verify on
[Etherscan Sepolia](https://sepolia.etherscan.io).

The `SettlementVault` contract emits:
```
ExecutionSettled(executionId, workflowId, agentAddress, creatorAddress,
                 pricePaid, creatorPayout, protocolFee, agentRefund,
                 success, outputsJson, errorMessage, settledAt)
```
