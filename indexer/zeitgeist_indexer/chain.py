"""Post oracle targets on-chain and trigger funding, via Foundry's `cast` (no web3 dependency).

The signing key is read from the PRIVATE_KEY environment variable and passed to cast through its
own environment (ETH_PRIVATE_KEY is not used, the key never appears in argv or logs).
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

from .gkg import ts_to_dt

CAST = shutil.which("cast") or str(Path.home() / ".foundry" / "bin" / "cast")


def category_id(key: str) -> str:
    b = key.encode()
    if len(b) > 32:
        raise ValueError(f"category key too long for bytes32: {key}")
    return "0x" + b.hex().ljust(64, "0")


def _cast(args: list[str], rpc: str, send: bool) -> str:
    cmd = [CAST, *args, "--rpc-url", rpc]
    env = dict(os.environ)
    if send:
        if not env.get("PRIVATE_KEY"):
            raise RuntimeError("set PRIVATE_KEY in the environment to sign transactions")
        cmd += ["--private-key", env["PRIVATE_KEY"]]
    r = subprocess.run(cmd, capture_output=True, text=True, env=env)
    if r.returncode != 0:
        msg = r.stderr.strip().replace(env.get("PRIVATE_KEY", "\0"), "<key>")
        raise RuntimeError(f"cast {args[0]} failed: {msg[-400:]}")
    return r.stdout.strip()


def post_targets(rpc: str, deployment: dict, key: str, as_of: str, inputs_hash: str, targets: list[int]) -> str:
    oracle = deployment["oracle"]
    as_of_unix = str(int(ts_to_dt(as_of).timestamp()))
    arr = "[" + ",".join(str(t) for t in targets) + "]"
    return _cast(["send", oracle, "post(bytes32,uint64,bytes32,uint256[])", category_id(key), as_of_unix, "0x" + inputs_hash, arr], rpc, True)


def last_posted(rpc: str, deployment: dict, key: str) -> int:
    out = _cast(["call", deployment["oracle"], "latest(bytes32)((uint64,uint64,bytes32,uint256[]))", category_id(key)], rpc, False)
    return int(out.strip("()").split(",")[0].split()[0])


def entity_count(rpc: str, deployment: dict, key: str) -> int:
    return int(_cast(["call", deployment[key], "entityCount()(uint256)"], rpc, False).split()[0])


def try_fund(rpc: str, deployment: dict, key: str) -> bool:
    market = deployment[key]
    cur = int(_cast(["call", market, "currentEpoch()(uint256)"], rpc, False).split()[0])
    last = int(_cast(["call", market, "lastFundedEpoch()(uint256)"], rpc, False).split()[0])
    if cur <= last:
        return False
    _cast(["send", market, "applyFunding()"], rpc, True)
    return True


def load_deployment(path: str) -> dict:
    return json.loads(Path(path).read_text())
