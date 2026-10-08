// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {TestUSDC} from "../src/TestUSDC.sol";
import {AttentionOracle} from "../src/AttentionOracle.sol";
import {CategoryMarket} from "../src/CategoryMarket.sol";
import {Zeit} from "../src/Zeit.sol";
import {VotingEscrow} from "../src/VotingEscrow.sol";
import {CategoryVoter} from "../src/CategoryVoter.sol";
import {Minter} from "../src/Minter.sol";
import {EntityGauge} from "../src/EntityGauge.sol";
import {ZeitgeistReceiver} from "../src/ZeitgeistReceiver.sol";
import {SealedCalls} from "../src/SealedCalls.sol";

/// forge script script/Deploy.s.sol --rpc-url $RPC --broadcast
/// env: PRIVATE_KEY (deployer, also first reporter), EPOCH_SECONDS (default 8h),
///      SEED_RESERVE (default 1,000 tUSD), SEED_SUPPLY (default 2,000 shares → $1.00 start price),
///      CRE_FORWARDER (Chainlink forwarder that may call the receiver; default: deployer, for local runs)
contract Deploy is Script {
    using stdJson for string;

    TestUSDC usd;
    AttentionOracle oracle;
    Zeit zeit;
    CategoryVoter voter;
    ZeitgeistReceiver receiver;
    Minter minter;
    address me;
    uint256 epoch;
    uint256 seedR;
    uint256 seedS;
    string doc;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        me = vm.addr(pk);
        epoch = vm.envOr("EPOCH_SECONDS", uint256(8 hours));
        seedR = vm.envOr("SEED_RESERVE", uint256(1_000e6));
        seedS = vm.envOr("SEED_SUPPLY", uint256(2_000e18));
        doc = vm.readFile(string.concat(vm.projectRoot(), "/script/entities.json"));
        uint256 nCats = abi.decode(vm.parseJson(doc, ".categories"), (bytes[])).length;

        vm.startBroadcast(pk);
        usd = new TestUSDC();
        oracle = new AttentionOracle(me);
        oracle.setReporter(me, true);
        usd.mint(me, 10_000_000e6);
        // ve(3,3) layer: 100M initial ZEIT to the deployer (allocation per spec happens off-script),
        // 1.5M/week emissions decaying 1%/week, 5% to team (deployer on testnet)
        zeit = new Zeit(me, me, 100_000_000e18);
        VotingEscrow ve = new VotingEscrow(address(zeit));
        voter = new CategoryVoter(me, address(ve), address(zeit), me);
        minter = new Minter(address(zeit), address(voter), me, 1_500_000e18);
        zeit.setMinter(address(minter));
        voter.setMinter(address(minter));
        receiver = new ZeitgeistReceiver(me, address(oracle), vm.envOr("CRE_FORWARDER", me));
        oracle.setReporter(address(receiver), true);
        receiver.setMinter(address(minter));
        vm.serializeAddress("deploy", "usd", address(usd));
        vm.serializeAddress("deploy", "oracle", address(oracle));
        vm.serializeAddress("deploy", "zeit", address(zeit));
        vm.serializeAddress("deploy", "ve", address(ve));
        vm.serializeAddress("deploy", "voter", address(voter));
        vm.serializeAddress("deploy", "minter", address(minter));
        vm.serializeAddress("deploy", "receiver", address(receiver));
        vm.serializeAddress("deploy", "calls", address(new SealedCalls()));
        string memory json = vm.serializeUint("deploy", "epochSeconds", epoch);
        for (uint256 c; c < nCats; ++c) json = _category(c);
        vm.stopBroadcast();
        vm.writeJson(json, string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json"));
    }

    function _category(uint256 c) internal returns (string memory json) {
        string memory base = string.concat(".categories[", vm.toString(c), "]");
        string memory key = doc.readString(string.concat(base, ".key"));
        string[] memory names = doc.readStringArray(string.concat(base, ".names"));
        string[] memory symbols = doc.readStringArray(string.concat(base, ".symbols"));
        CategoryMarket m = new CategoryMarket(CategoryMarket.Config({
            asset: address(usd), oracle: address(oracle), categoryId: bytes32(bytes(key)),
            epochLength: epoch, k: 0.15e18, cap: 0.08e18, feeBps: 50,
            maxOracleAge: 2 hours, // GDELT batch times lag real time by 15+ min; short demo epochs need the same slack
            feeSink: me, owner: me
        }));
        usd.approve(address(m), type(uint256).max);
        for (uint256 i; i < names.length; ++i) m.list(names[i], symbols[i], seedR, seedS, me);
        EntityGauge g = new EntityGauge(address(m), address(zeit), address(voter));
        voter.addCategory(bytes32(bytes(key)), address(g));
        m.setVoter(address(voter));
        receiver.setMarket(bytes32(bytes(key)), address(m));
        console2.log(key, address(m), names.length);
        vm.serializeAddress("deploy", string.concat(key, "_gauge"), address(g));
        json = vm.serializeAddress("deploy", key, address(m));
    }
}
