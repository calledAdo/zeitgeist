// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {CategoryMarket} from "../src/CategoryMarket.sol";
import {TestUSDC} from "../src/TestUSDC.sol";

/// Lists one more entity in an existing category, seeded at fair value so funding doesn't pump it
/// with other holders' money ("list cheap, get pumped" trap, SPEC v1 §6).
///   seed reserve = average reserve of the listed entities  (≈ its target at heat 0 = ΣR/N)
///   seed supply  = chosen so its starting price equals the average price
/// env: PRIVATE_KEY, MARKET, NAME, SYMBOL. Then give the entity `"index": <entityCount before>` in
/// indexer/registry/entities.json (append-only) so the reporter includes it.
contract AddEntity is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        CategoryMarket m = CategoryMarket(vm.envAddress("MARKET"));
        (uint256 seedR, uint256 seedS) = _seed(m);
        address me = vm.addr(pk);
        vm.startBroadcast(pk);
        TestUSDC(m.asset()).approve(address(m), seedR);
        uint256 idx = m.list(vm.envString("NAME"), vm.envString("SYMBOL"), seedR, seedS, me);
        vm.stopBroadcast();
        console2.log("listed at index", idx);
        console2.log("seed reserve", seedR);
    }

    function _seed(CategoryMarket m) internal view returns (uint256 seedR, uint256 seedS) {
        uint256 n = m.entityCount();
        uint256[] memory r = m.reserves();
        uint256 sumR;
        uint256 sumP;
        for (uint256 i; i < n; ++i) { sumR += r[i]; sumP += m.price(i); }
        seedR = sumR / n;
        seedS = 2 * seedR * 1e18 / (sumP / n); // price = 2R/S
    }
}
