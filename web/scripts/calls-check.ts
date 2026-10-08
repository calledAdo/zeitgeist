// Checks the sealed-call crypto with a fixed root (stands in for the passkey PRF output).
import { callKey, openCall, sealCall } from "../src/lib/calls-crypto";
import { bytesToHex } from "viem";
const root = new Uint8Array(32).fill(9);
const id1 = "0x000102030405060708090a0b0c0d0e0f", id2 = "0x0f0e0d0c0b0a09080706050403020100";
const k1 = await callKey(root, id1), k1b = await callKey(root.slice(), id1), k2 = await callKey(root, id2);
console.log("deterministic per call:", bytesToHex(k1) === bytesToHex(k1b));
console.log("independent across calls:", bytesToHex(k1) !== bytesToHex(k2));
const sealed = await sealCall(k1, { v: 1, category: "geopolitics", key: "merz", dir: "up", note: "coalition talks" });
console.log("opens with its key:", JSON.stringify(await openCall(bytesToHex(k1), sealed)));
console.log("another call's key fails:", await openCall(k2, sealed));
console.log("sealed size (bytes):", (sealed.length - 2) / 2);
