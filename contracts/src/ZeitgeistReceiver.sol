// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "solady/auth/Ownable.sol";

interface IAttentionOracle {
    function post(bytes32 category, uint64 asOf, bytes32 inputsHash, uint256[] calldata targets) external;
}

interface IFundable {
    function applyFunding() external returns (int256[] memory);
    function collectFees() external;
}

interface IMinter {
    function updatePeriod() external returns (uint256);
}

/// @notice Chainlink CRE consumer: a DON-signed report posts every category's targets to the
///         oracle, then runs whatever is due (funding, fee collection, weekly emission).
/// @dev Reports arrive only through the Chainlink KeystoneForwarder, which has already checked
///      the DON's signatures. The workflow owner (and optionally the workflow id) is pinned so a
///      different workflow on the same forwarder cannot post. Each follow-up call is wrapped in
///      try/catch: "not due yet" must never block a valid post.
contract ZeitgeistReceiver is Ownable {
    error NotForwarder();
    error WrongWorkflow();

    struct CategoryReport {
        bytes32 category;
        uint64 asOf;
        bytes32 inputsHash;
        uint256[] targets;
    }

    IAttentionOracle public immutable oracle;
    address public forwarder;
    address public workflowOwner;   // zero = not checked (local simulation)
    bytes32 public workflowId;      // zero = not checked
    IMinter public minter;
    mapping(bytes32 => address) public marketOf;

    event ForwarderSet(address forwarder);
    event WorkflowSet(address owner, bytes32 id);
    event MarketSet(bytes32 indexed category, address market);
    event ReportApplied(bytes32 indexed workflowId, uint256 categories, uint256 funded);
    event StepSkipped(bytes32 indexed category, bytes4 step, bytes reason);

    constructor(address owner_, address oracle_, address forwarder_) {
        _initializeOwner(owner_);
        oracle = IAttentionOracle(oracle_);
        forwarder = forwarder_;
    }

    function setForwarder(address f) external onlyOwner {
        forwarder = f;
        emit ForwarderSet(f);
    }

    function setWorkflow(address owner_, bytes32 id) external onlyOwner {
        workflowOwner = owner_;
        workflowId = id;
        emit WorkflowSet(owner_, id);
    }

    function setMarket(bytes32 category, address market) external onlyOwner {
        marketOf[category] = market;
        emit MarketSet(category, market);
    }

    function setMinter(address m) external onlyOwner {
        minter = IMinter(m);
    }

    /// @notice IReceiver entry point. `report` = abi.encode(CategoryReport[]).
    function onReport(bytes calldata metadata, bytes calldata report) external {
        if (msg.sender != forwarder) revert NotForwarder();
        (bytes32 wid, address wowner) = _meta(metadata);
        if (workflowOwner != address(0) && wowner != workflowOwner) revert WrongWorkflow();
        if (workflowId != bytes32(0) && wid != workflowId) revert WrongWorkflow();

        CategoryReport[] memory reps = abi.decode(report, (CategoryReport[]));
        uint256 funded;
        for (uint256 i; i < reps.length; ++i) {
            CategoryReport memory r = reps[i];
            // a stale or already-posted snapshot is skipped, not fatal: other categories still apply
            try oracle.post(r.category, r.asOf, r.inputsHash, r.targets) {}
            catch (bytes memory why) { emit StepSkipped(r.category, IAttentionOracle.post.selector, why); }
            address m = marketOf[r.category];
            if (m == address(0)) continue;
            try IFundable(m).applyFunding() { ++funded; }
            catch (bytes memory why) { emit StepSkipped(r.category, IFundable.applyFunding.selector, why); }
            try IFundable(m).collectFees() {}
            catch (bytes memory why) { emit StepSkipped(r.category, IFundable.collectFees.selector, why); }
        }
        if (address(minter) != address(0)) {
            try minter.updatePeriod() {}
            catch (bytes memory why) { emit StepSkipped(bytes32(0), IMinter.updatePeriod.selector, why); }
        }
        emit ReportApplied(wid, reps.length, funded);
    }

    function supportsInterface(bytes4 id) external pure returns (bool) {
        return id == this.onReport.selector || id == 0x01ffc9a7; // IReceiver, IERC165
    }

    /// @dev KeystoneForwarder metadata: workflowId (32) | workflowName (10) | workflowOwner (20).
    function _meta(bytes calldata m) internal pure returns (bytes32 wid, address wowner) {
        if (m.length < 62) return (bytes32(0), address(0));
        wid = bytes32(m[0:32]);
        wowner = address(bytes20(m[42:62]));
    }
}
