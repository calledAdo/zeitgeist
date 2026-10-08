// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "solady/auth/Ownable.sol";

/// @notice Stores the latest funding targets per category, posted by allowlisted reporters.
/// @dev Targets are 1e18-scaled shares of the category's reserve, aligned with the market's
///      entity index. A zero target means "not funding-eligible this epoch" (history or volume gate).
///      `inputsHash` commits to every GDELT file (stamp + md5), the registry digest and params
///      version used, so anyone can recompute the post off-chain and dispute it.
contract AttentionOracle is Ownable {
    error NotReporter();
    error BadTargets();
    error StaleAsOf();

    struct Post {
        uint64 asOf;        // GDELT batch time the snapshot was computed at (unix seconds)
        uint64 postedAt;
        bytes32 inputsHash;
        uint256[] targets;  // 1e18-scaled; eligible entries sum to exactly 1e18
    }

    mapping(address => bool) public isReporter;
    mapping(bytes32 => Post) internal _latest;

    event ReporterSet(address indexed reporter, bool allowed);
    event TargetsPosted(bytes32 indexed category, uint64 asOf, bytes32 inputsHash, uint256[] targets);

    constructor(address owner_) {
        _initializeOwner(owner_);
    }

    function setReporter(address reporter, bool allowed) external onlyOwner {
        isReporter[reporter] = allowed;
        emit ReporterSet(reporter, allowed);
    }

    function post(bytes32 category, uint64 asOf, bytes32 inputsHash, uint256[] calldata targets) external {
        if (!isReporter[msg.sender]) revert NotReporter();
        Post storage p = _latest[category];
        if (asOf <= p.asOf) revert StaleAsOf();
        uint256 sum;
        for (uint256 i; i < targets.length; ++i) sum += targets[i];
        if (sum != 1e18) revert BadTargets();
        p.asOf = asOf;
        p.postedAt = uint64(block.timestamp);
        p.inputsHash = inputsHash;
        p.targets = targets;
        emit TargetsPosted(category, asOf, inputsHash, targets);
    }

    function latest(bytes32 category) external view returns (Post memory) {
        return _latest[category];
    }
}
