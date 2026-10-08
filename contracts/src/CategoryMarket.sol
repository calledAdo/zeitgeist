// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "solady/auth/Ownable.sol";
import {ReentrancyGuard} from "solady/utils/ReentrancyGuard.sol";
import {FixedPointMathLib as M} from "solady/utils/FixedPointMathLib.sol";
import {SafeTransferLib} from "solady/utils/SafeTransferLib.sol";
import {EntityToken} from "./EntityToken.sol";
import {AttentionOracle} from "./AttentionOracle.sol";

interface IRewardSink {
    function notifyReward(bytes32 category, address token, uint256 amount) external;
}

/// @title CategoryMarket
/// @notice One market per category (e.g. Geopolitics). Each entity has its own bonding curve and
///         reserve in the settlement asset (USDC). Every funding epoch, reserves move between the
///         entities toward the oracle's character-relative attention targets.
///
/// Curve: Bancor with connector weight 0.5, i.e. R = c·S². Buying with net USDC x:
///         S' = S·sqrt((R + x) / R). Selling s shares: R' = R·((S − s) / S)².
///         Spot price = 2R / S. Because funding changes R and never S, a funding transfer ΔR moves
///         every holder's price by exactly ΔR / R, with no slippage and nothing to claim.
///
/// Funding (spec v4): ΔR_i = k·(target_i·ΣR − R_i), each |ΔR_i| capped at cap·R_i, then the larger
///         side (payers or receivers) is scaled down so ΣΔR = 0 exactly. Only entities with a
///         non-zero target take part (same-set rule).
contract CategoryMarket is Ownable, ReentrancyGuard {
    using SafeTransferLib for address;

    error BadIndex();
    error Slippage();
    error ZeroAmount();
    error AlreadyFunded();
    error StaleOracle();
    error TargetsMismatch();
    error NotSeeded();

    uint256 internal constant WAD = 1e18;
    uint256 internal constant BPS = 10_000;

    address public immutable asset;        // USDC
    AttentionOracle public immutable oracle;
    bytes32 public immutable categoryId;
    uint256 public immutable epochLength;  // 8 hours in production
    uint256 public immutable k;            // 0.15e18
    uint256 public immutable cap;          // 0.08e18
    uint256 public immutable feeBps;       // 50 = 0.5% per side
    uint256 public immutable maxOracleAge; // post must be at most this old at the epoch boundary

    address public feeSink;               // treasury: receives the non-voter share
    address public voter;                 // CategoryVoter: receives voterShareBps of fees for this category's voters
    uint256 public voterShareBps = 7_000; // 70% to voters (spec v4)
    uint256 public accruedFees;
    uint256 public lastFundedEpoch;

    struct Entity {
        EntityToken token;
        uint256 reserve;
    }

    Entity[] internal _entities;

    event Listed(uint256 indexed index, address token, string name, uint256 reserve, uint256 supply);
    event Bought(uint256 indexed index, address indexed buyer, address indexed to, uint256 assetIn, uint256 fee, uint256 sharesOut);
    event Sold(uint256 indexed index, address indexed seller, address indexed to, uint256 sharesIn, uint256 fee, uint256 assetOut);
    event Funded(uint256 indexed epoch, bytes32 inputsHash, int256[] deltas);
    event FeeSinkSet(address sink);
    event VoterSet(address voter);
    event FeesCollected(uint256 toVoters, uint256 toTreasury);

    struct Config {
        address asset;
        address oracle;
        bytes32 categoryId;
        uint256 epochLength;
        uint256 k;
        uint256 cap;
        uint256 feeBps;
        uint256 maxOracleAge;
        address feeSink;
        address owner;
    }

    constructor(Config memory c) {
        asset = c.asset;
        oracle = AttentionOracle(c.oracle);
        categoryId = c.categoryId;
        epochLength = c.epochLength;
        k = c.k;
        cap = c.cap;
        feeBps = c.feeBps;
        maxOracleAge = c.maxOracleAge;
        feeSink = c.feeSink;
        _initializeOwner(c.owner);
        lastFundedEpoch = block.timestamp / c.epochLength;
    }

    // ------------------------------------------------------------------ admin

    /// @notice List an entity, seeding its curve with protocol-owned reserve so it never starts at zero
    ///         supply (no launch sniping). Seed shares go to `seedTo` (treasury).
    function list(string calldata name, string calldata symbol, uint256 seedReserve, uint256 seedSupply, address seedTo)
        external
        onlyOwner
        returns (uint256 index)
    {
        if (seedReserve == 0 || seedSupply == 0) revert ZeroAmount();
        asset.safeTransferFrom(msg.sender, address(this), seedReserve);
        EntityToken t = new EntityToken(name, symbol);
        t.mint(seedTo, seedSupply);
        index = _entities.length;
        _entities.push(Entity(t, seedReserve));
        emit Listed(index, address(t), name, seedReserve, seedSupply);
    }

    function setFeeSink(address sink) external onlyOwner {
        feeSink = sink;
        emit FeeSinkSet(sink);
    }

    function setVoter(address voter_) external onlyOwner {
        voter = voter_;
        emit VoterSet(voter_);
    }

    /// @notice Permissionless: route accrued trading fees — voterShareBps to this category's voters, rest to treasury.
    function collectFees() external nonReentrant {
        uint256 amt = accruedFees;
        if (amt == 0) return;
        accruedFees = 0;
        uint256 toVoters = voter == address(0) ? 0 : amt * voterShareBps / BPS;
        if (toVoters != 0) {
            asset.safeApprove(voter, toVoters);
            IRewardSink(voter).notifyReward(categoryId, asset, toVoters);
        }
        if (amt > toVoters) asset.safeTransfer(feeSink, amt - toVoters);
        emit FeesCollected(toVoters, amt - toVoters);
    }

    // ------------------------------------------------------------------ trading

    function buy(uint256 i, uint256 assetIn, uint256 minSharesOut, address to)
        external
        nonReentrant
        returns (uint256 sharesOut)
    {
        Entity storage e = _entity(i);
        uint256 fee;
        (sharesOut, fee) = quoteBuy(i, assetIn);
        if (sharesOut == 0) revert ZeroAmount();
        if (sharesOut < minSharesOut) revert Slippage();
        asset.safeTransferFrom(msg.sender, address(this), assetIn);
        accruedFees += fee;
        e.reserve += assetIn - fee;
        e.token.mint(to, sharesOut);
        emit Bought(i, msg.sender, to, assetIn, fee, sharesOut);
    }

    function sell(uint256 i, uint256 sharesIn, uint256 minAssetOut, address to)
        external
        nonReentrant
        returns (uint256 assetOut)
    {
        Entity storage e = _entity(i);
        uint256 gross;
        uint256 fee;
        (assetOut, fee, gross) = _quoteSell(i, sharesIn);
        if (assetOut < minAssetOut) revert Slippage();
        e.token.burn(msg.sender, sharesIn);
        e.reserve -= gross;
        accruedFees += fee;
        asset.safeTransfer(to, assetOut);
        emit Sold(i, msg.sender, to, sharesIn, fee, assetOut);
    }

    function quoteBuy(uint256 i, uint256 assetIn) public view returns (uint256 sharesOut, uint256 fee) {
        Entity storage e = _entity(i);
        if (assetIn == 0) revert ZeroAmount();
        fee = assetIn * feeBps / BPS;
        uint256 net = assetIn - fee;
        uint256 r = e.reserve;
        uint256 s = e.token.totalSupply();
        if (r == 0 || s == 0) revert NotSeeded();
        // S' = S · sqrt((R + net) / R), rounded down (buyer gets the dust-free side)
        uint256 root = M.sqrt(M.fullMulDiv(r + net, WAD * WAD, r)); // sqrt(ratio)·1e18
        uint256 newS = M.fullMulDiv(s, root, WAD);
        sharesOut = newS > s ? newS - s : 0;
    }

    function quoteSell(uint256 i, uint256 sharesIn) external view returns (uint256 assetOut, uint256 fee) {
        (assetOut, fee,) = _quoteSell(i, sharesIn);
    }

    function _quoteSell(uint256 i, uint256 sharesIn) internal view returns (uint256 assetOut, uint256 fee, uint256 gross) {
        Entity storage e = _entity(i);
        if (sharesIn == 0) revert ZeroAmount();
        uint256 s = e.token.totalSupply();
        uint256 r = e.reserve;
        uint256 newS = s - sharesIn; // reverts if selling more than supply
        // R' = R · (S'/S)², rounded up so the reserve never under-covers remaining holders
        uint256 newR = M.fullMulDivUp(M.fullMulDivUp(r, newS, s), newS, s);
        gross = r - newR;
        fee = gross * feeBps / BPS;
        assetOut = gross - fee;
    }

    // ------------------------------------------------------------------ funding

    function currentEpoch() public view returns (uint256) {
        return block.timestamp / epochLength;
    }

    /// @notice Permissionless: anyone can trigger funding once per epoch using the oracle's latest post.
    function applyFunding() external nonReentrant returns (int256[] memory deltas) {
        uint256 epoch = currentEpoch();
        if (epoch <= lastFundedEpoch) revert AlreadyFunded();
        AttentionOracle.Post memory p = oracle.latest(categoryId);
        if (p.asOf == 0 || uint256(p.asOf) + maxOracleAge < epoch * epochLength) revert StaleOracle();
        deltas = previewFunding(p.targets);
        lastFundedEpoch = epoch;
        uint256 n = deltas.length;
        for (uint256 i; i < n; ++i) {
            int256 d = deltas[i];
            if (d > 0) _entities[i].reserve += uint256(d);
            else if (d < 0) _entities[i].reserve -= uint256(-d);
        }
        emit Funded(epoch, p.inputsHash, deltas);
    }

    /// @notice The transfers funding would make for a given target vector. Σ deltas == 0 exactly.
    function previewFunding(uint256[] memory targets) public view returns (int256[] memory deltas) {
        uint256 n = _entities.length;
        if (targets.length != n) revert TargetsMismatch();
        deltas = new int256[](n);

        uint256 total;
        for (uint256 i; i < n; ++i) if (targets[i] != 0) total += _entities[i].reserve;
        if (total == 0) return deltas;

        // raw capped moves
        uint256 pos;
        uint256 neg;
        for (uint256 i; i < n; ++i) {
            if (targets[i] == 0) continue;
            uint256 r = _entities[i].reserve;
            uint256 desired = M.fullMulDiv(targets[i], total, WAD);
            uint256 lim = M.fullMulDiv(r, cap, WAD);
            if (desired > r) {
                uint256 d = M.min(M.fullMulDiv(desired - r, k, WAD), lim);
                deltas[i] = int256(d);
                pos += d;
            } else if (r > desired) {
                uint256 d = M.min(M.fullMulDiv(r - desired, k, WAD), lim);
                deltas[i] = -int256(d);
                neg += d;
            }
        }
        if (pos == 0 || neg == 0) {
            for (uint256 i; i < n; ++i) deltas[i] = 0;
            return deltas;
        }

        // scale the larger side down to the smaller so the category stays zero-sum
        uint256 f = M.min(pos, neg);
        uint256 sp;
        uint256 sn;
        uint256 iMaxPos;
        uint256 iMaxNeg;
        for (uint256 i; i < n; ++i) {
            int256 d = deltas[i];
            if (d > 0) {
                uint256 v = M.fullMulDiv(uint256(d), f, pos);
                deltas[i] = int256(v);
                sp += v;
                if (deltas[iMaxPos] <= 0 || v > uint256(deltas[iMaxPos])) iMaxPos = i;
            } else if (d < 0) {
                uint256 v = M.fullMulDiv(uint256(-d), f, neg);
                deltas[i] = -int256(v);
                sn += v;
                if (deltas[iMaxNeg] >= 0 || v > uint256(-deltas[iMaxNeg])) iMaxNeg = i;
            }
        }
        // rounding residue (at most n wei) comes off the largest move on the heavier side
        if (sp > sn) deltas[iMaxPos] -= int256(sp - sn);
        else if (sn > sp) deltas[iMaxNeg] += int256(sn - sp);
    }

    // ------------------------------------------------------------------ views

    function entityCount() external view returns (uint256) {
        return _entities.length;
    }

    function entity(uint256 i) external view returns (address token, uint256 reserve, uint256 supply) {
        Entity storage e = _entity(i);
        return (address(e.token), e.reserve, e.token.totalSupply());
    }

    /// @notice Spot price in asset units per 1e18 shares: 2R/S.
    function price(uint256 i) external view returns (uint256) {
        Entity storage e = _entity(i);
        return M.fullMulDiv(2 * e.reserve, WAD, e.token.totalSupply());
    }

    function reserves() external view returns (uint256[] memory r) {
        r = new uint256[](_entities.length);
        for (uint256 i; i < r.length; ++i) r[i] = _entities[i].reserve;
    }

    function _entity(uint256 i) internal view returns (Entity storage) {
        if (i >= _entities.length) revert BadIndex();
        return _entities[i];
    }
}
