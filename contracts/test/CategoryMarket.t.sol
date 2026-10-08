// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {CategoryMarket} from "../src/CategoryMarket.sol";
import {AttentionOracle} from "../src/AttentionOracle.sol";
import {EntityToken} from "../src/EntityToken.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

contract Base is Test {
    MockUSDC usdc;
    AttentionOracle oracle;
    CategoryMarket market;
    bytes32 constant CAT = "geopolitics";
    address treasury = makeAddr("treasury");
    address sink = makeAddr("sink");
    address reporter = makeAddr("reporter");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    uint256 constant N = 4;

    function setUp() public virtual {
        vm.warp(1_790_000_000);
        usdc = new MockUSDC();
        oracle = new AttentionOracle(address(this));
        oracle.setReporter(reporter, true);
        market = new CategoryMarket(CategoryMarket.Config({
            asset: address(usdc), oracle: address(oracle), categoryId: CAT, epochLength: 8 hours,
            k: 0.15e18, cap: 0.08e18, feeBps: 50, maxOracleAge: 2 hours, feeSink: sink, owner: address(this)
        }));
        usdc.mint(address(this), 1e15);
        usdc.approve(address(market), type(uint256).max);
        // equal seeds: $25k reserve and 100k shares each (fair at rest: every target = 1/N)
        for (uint256 i; i < N; ++i) market.list("E", "E", 25_000e6, 100_000e18, treasury);
        for (uint256 j; j < 2; ++j) {
            address u = j == 0 ? alice : bob;
            usdc.mint(u, 1e13);
            vm.prank(u);
            usdc.approve(address(market), type(uint256).max);
        }
    }

    function _post(uint256[] memory t) internal {
        vm.prank(reporter);
        oracle.post(CAT, uint64(block.timestamp), keccak256("inputs"), t);
    }

    function _nextEpoch() internal {
        vm.warp((block.timestamp / 8 hours + 1) * 8 hours + 1);
    }

    function _sum(uint256[] memory r) internal pure returns (uint256 s) {
        for (uint256 i; i < r.length; ++i) s += r[i];
    }
}

contract CategoryMarketTest is Base {
    function test_buyThenSellLosesOnlyFees() public {
        vm.startPrank(alice);
        uint256 before = usdc.balanceOf(alice);
        uint256 shares = market.buy(0, 1_000e6, 0, alice);
        market.sell(0, shares, 0, alice);
        vm.stopPrank();
        uint256 lost = before - usdc.balanceOf(alice);
        // 0.5% in + ~0.5% out, never more than 1% + rounding
        assertLe(lost, 10e6 + 2);
        assertGe(lost, 9.9e6);
    }

    function test_priceIsTwoRoverS() public view {
        (, uint256 r, uint256 s) = market.entity(0);
        assertEq(market.price(0), 2 * r * 1e18 / s);
        assertEq(market.price(0), 0.5e6); // $0.50 per share at seed
    }

    function test_buyRaisesPrice_sellLowers() public {
        uint256 p0 = market.price(1);
        vm.prank(alice);
        uint256 sh = market.buy(1, 5_000e6, 0, alice);
        uint256 p1 = market.price(1);
        assertGt(p1, p0);
        vm.prank(alice);
        market.sell(1, sh, 0, alice);
        assertApproxEqAbs(market.price(1), p0, 2);
    }

    function test_slippageGuard() public {
        (uint256 q,) = market.quoteBuy(0, 1_000e6);
        vm.prank(alice);
        vm.expectRevert(CategoryMarket.Slippage.selector);
        market.buy(0, 1_000e6, q + 1, alice);
    }

    function test_fundingMovesReserveTowardTarget_zeroSum() public {
        uint256[] memory t = new uint256[](N);
        t[0] = 0.40e18; t[1] = 0.20e18; t[2] = 0.20e18; t[3] = 0.20e18;
        _nextEpoch();
        _post(t);
        uint256 total = _sum(market.reserves());
        uint256 p0 = market.price(0);
        int256[] memory d = market.applyFunding();
        uint256[] memory r = market.reserves();
        assertEq(_sum(r), total, "zero-sum");
        // entity 0 wants +$15k (40% of 100k − 25k); k=0.15 → +2,250 but cap 8% of 25k = 2,000
        assertApproxEqAbs(d[0], 2_000e6, N); // rounding residue (≤ N wei) comes off the largest move
        // payers each want −0.15·5,000 = −750 → total −2,250, scaled down to −2,000 total
        assertEq(uint256(-d[1]) + uint256(-d[2]) + uint256(-d[3]), uint256(d[0]));
        // price moved by exactly ΔR/R = +8%
        assertApproxEqAbs(market.price(0), p0 * 108 / 100, 1); // 1 micro-USDC rounding
    }

    function test_fundingOncePerEpoch() public {
        uint256[] memory t = new uint256[](N);
        t[0] = 0.25e18; t[1] = 0.25e18; t[2] = 0.25e18; t[3] = 0.25e18;
        _nextEpoch();
        _post(t);
        market.applyFunding();
        vm.expectRevert(CategoryMarket.AlreadyFunded.selector);
        market.applyFunding();
    }

    function test_staleOracleReverts() public {
        uint256[] memory t = new uint256[](N);
        t[0] = 1e18;
        _post(t);
        vm.warp(block.timestamp + 3 days);
        vm.expectRevert(CategoryMarket.StaleOracle.selector);
        market.applyFunding();
    }

    function test_ineligibleEntityUntouched() public {
        uint256[] memory t = new uint256[](N);
        t[0] = 0.6e18; t[1] = 0.4e18; // 2 and 3 excluded (target 0)
        _nextEpoch();
        _post(t);
        (, uint256 r2,) = market.entity(2);
        int256[] memory d = market.applyFunding();
        (, uint256 r2b,) = market.entity(2);
        assertEq(r2, r2b);
        assertEq(d[2], 0);
        assertEq(d[3], 0);
        assertEq(d[0] + d[1], 0);
    }

    function test_convergesOverEpochs() public {
        uint256[] memory t = new uint256[](N);
        t[0] = 0.40e18; t[1] = 0.20e18; t[2] = 0.20e18; t[3] = 0.20e18;
        for (uint256 e; e < 40; ++e) {
            _nextEpoch();
            _post(t);
            market.applyFunding();
        }
        uint256[] memory r = market.reserves();
        assertApproxEqRel(r[0] * 1e18 / _sum(r), 0.40e18, 0.01e18);
    }

    function test_oracleRejectsBadSum() public {
        uint256[] memory t = new uint256[](N);
        t[0] = 0.5e18;
        vm.prank(reporter);
        vm.expectRevert(AttentionOracle.BadTargets.selector);
        oracle.post(CAT, uint64(block.timestamp), bytes32(0), t);
    }

    function testFuzz_fundingZeroSumAndCapped(uint256[4] memory raw, uint256[4] memory buys) public {
        for (uint256 i; i < N; ++i) {
            uint256 amt = bound(buys[i], 0, 200_000e6);
            if (amt > 0) { vm.prank(alice); market.buy(i, amt, 0, alice); }
        }
        uint256[] memory t = new uint256[](N);
        uint256 s;
        for (uint256 i; i < N; ++i) { t[i] = bound(raw[i], 0, 1e18); s += t[i]; }
        vm.assume(s > 0);
        uint256 acc;
        for (uint256 i; i < N; ++i) { t[i] = t[i] * 1e18 / s; acc += t[i]; }
        // push rounding residue onto the first non-zero entry
        for (uint256 i; i < N; ++i) if (t[i] != 0) { t[i] += 1e18 - acc; break; }
        uint256[] memory before = market.reserves();
        int256[] memory d = market.previewFunding(t);
        int256 sum;
        for (uint256 i; i < N; ++i) {
            sum += d[i];
            uint256 mag = d[i] >= 0 ? uint256(d[i]) : uint256(-d[i]);
            assertLe(mag, before[i] * 0.08e18 / 1e18 + N, "cap");
            if (t[i] == 0) assertEq(d[i], 0, "ineligible");
        }
        assertEq(sum, 0, "zero-sum");
    }
}
