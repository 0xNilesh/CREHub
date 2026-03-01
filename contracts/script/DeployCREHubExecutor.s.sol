// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {CREHubExecutor} from "../src/CREHubExecutor.sol";

/**
 * @notice Deploys CREHubExecutor to Ethereum Sepolia.
 *
 * Usage:
 *   forge script script/DeployCREHubExecutor.s.sol \
 *     --rpc-url $SEPOLIA_RPC_URL \
 *     --private-key $GATEWAY_PRIVATE_KEY \
 *     --broadcast \
 *     -vvv
 *
 * Required env vars:
 *   CRE_FORWARDER      — Chainlink CRE Forwarder on Sepolia
 *                        (0x15fC6ae953E024d975e77382eEeC56A9101f9F88)
 *   SEPOLIA_RPC_URL    — Sepolia RPC endpoint
 *   GATEWAY_PRIVATE_KEY — deployer key
 *
 * After deployment, copy the logged executorAddress into all workflow
 * config.json files (aave-health-monitor, hello-world, ta-signal) →
 * "executorAddress" and set "skipOnChainWrite": false.
 */
contract DeployCREHubExecutor is Script {
    function run() external {
        address creForwarder = vm.envAddress("CRE_FORWARDER");

        vm.startBroadcast();

        CREHubExecutor executor = new CREHubExecutor(creForwarder);

        vm.stopBroadcast();

        console.log("===========================================");
        console.log("CREHubExecutor deployed at:", address(executor));
        console.log("CRE Forwarder set to:      ", creForwarder);
        console.log("===========================================");
        console.log("Next: paste executorAddress into all workflow config.json files:");
        console.log("  workflows/aave-health-monitor/config.json");
        console.log("  workflows/hello-world/config.json");
        console.log("  workflows/ta-signal/config.json");
        console.log("and set skipOnChainWrite: false");
    }
}
