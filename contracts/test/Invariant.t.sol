// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Base} from "./CategoryMarket.t.sol";
import {CategoryMarket} from "../src/CategoryMarket.sol";
import {AttentionOracle} from "../src/AttentionOracle.sol";
import {EntityToken} from "../src/EntityToken.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {Test} from "forge-std/Test.sol";

contract Handler is Test {
    CategoryMarket m;
    AttentionOracle o;
    MockUSDC usdc;
    address reporter;
    address[2] users;

    constructor(CategoryMarket m_, AttentionOracle o_, MockUSDC u_, address rep, address a, address b) {
        m = m_; o = o_; usdc = u_; reporter = rep; users = [a, b];
    }

    function buy(uint256 who, uint256 i, uint256 amt) external {
        address u = users[who % 2];
        i = i % m.entityCount();
        amt = bound(amt, 1e6, 100_000e6);
        vm.prank(u);
        m.buy(i, amt, 0, u);
    }

    function sell(uint256 who, uint256 i, uint256 frac) external {
        address u = users[who % 2];
        i = i % m.entityCount();
        (address tok,,) = m.entity(i);
        uint256 bal = EntityToken(tok).balanceOf(u);
        if (bal == 0) return;
        uint256 amt = bal * bound(frac, 1, 100) / 100;
        vm.prank(u);
        m.sell(i, amt, 0, u);
    }

    function fund(uint256 seed) external {
        uint256 n = m.entityCount();
        uint256[] memory t = new uint256[](n);
        uint256 s;
        for (uint256 i; i < n; ++i) { t[i] = uint256(keccak256(abi.encode(seed, i))) % 1e18; s += t[i]; }
        uint256 acc;
        for (uint256 i; i < n; ++i) { t[i] = t[i] * 1e18 / s; acc += t[i]; }
        t[0] += 1e18 - acc;
        vm.warp((block.timestamp / 8 hours + 1) * 8 hours + 1);
        vm.prank(reporter);
        o.post("geopolitics", uint64(block.timestamp), bytes32(seed), t);
        m.applyFunding();
    }
}

contract InvariantTest is Base {
    Handler h;

    function setUp() public override {
        super.setUp();
        h = new Handler(market, oracle, usdc, reporter, alice, bob);
        targetContract(address(h));
    }

    /// The market's USDC always equals the sum of reserves plus uncollected fees; funding is internal.
    function invariant_solvent() public view {
        assertEq(usdc.balanceOf(address(market)), _sum(market.reserves()) + market.accruedFees());
    }

    /// Every pool keeps a positive reserve while it has holders.
    function invariant_reservesPositive() public view {
        uint256[] memory r = market.reserves();
        for (uint256 i; i < r.length; ++i) assertGt(r[i], 0);
    }
}
