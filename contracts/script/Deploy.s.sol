// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {WorkflowRegistry} from "../src/WorkflowRegistry.sol";
import {SettlementVault} from "../src/SettlementVault.sol";
import {CREHubExecutor} from "../src/CREHubExecutor.sol";

/**
 * @title Deploy
 * @notice Deploys WorkflowRegistry and SettlementVault to Ethereum Sepolia
 *         and wires them together.
 *
 * Usage:
 *   forge script script/Deploy.s.sol \
 *     --rpc-url $SEPOLIA_RPC_URL \
 *     --private-key $GATEWAY_PRIVATE_KEY \
 *     --broadcast \
 *     --verify \
 *     --etherscan-api-key $ETHERSCAN_API_KEY
 *
 * Required env vars:
 *   USDC_ADDRESS       – Circle official USDC on Sepolia
 *   TREASURY_WALLET    – receives protocol fees
 *   GATEWAY_ADDRESS    – CREHub gateway EOA (trusted caller for settle*)
 */
contract Deploy is Script {
    function run() external {
        address usdc        = vm.envAddress("USDC_ADDRESS");
        address treasury    = vm.envAddress("TREASURY_WALLET");
        address gateway     = vm.envAddress("GATEWAY_ADDRESS");
        address cre_forwarder = vm.envAddress("CRE_FORWARDER");

        vm.startBroadcast();

        WorkflowRegistry registry = new WorkflowRegistry();
        console.log("WorkflowRegistry deployed at:", address(registry));

        SettlementVault vault = new SettlementVault(usdc, treasury, address(registry));
        console.log("SettlementVault deployed at:", address(vault));

        // Wire: vault is the only address allowed to call recordExecution on registry
        registry.setSettlementVault(address(vault));
        console.log("registry.setSettlementVault ->", address(vault));

        // Trust the gateway to call createEscrow / settle*
        vault.setGateway(gateway);
        console.log("vault.setGateway ->", gateway);

        // CRE on-chain executor — receives signed reports from the CRE Forwarder
        CREHubExecutor executor = new CREHubExecutor(cre_forwarder);
        console.log("CREHubExecutor deployed at:", address(executor));

        vm.stopBroadcast();

        console.log("\n=== Deployment complete ===");
        console.log("Copy these into gateway/.env:");
        console.log("WORKFLOW_REGISTRY_ADDRESS=", address(registry));
        console.log("SETTLEMENT_VAULT_ADDRESS=", address(vault));
        console.log("\nCopy this into workflows/aave-health-monitor/config.json:");
        console.log("executorAddress=", address(executor));
    }
}
