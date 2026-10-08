// Sealed calls: per-call encryption keys from the passkey, with nothing stored.
//
//   root    = Mera PRF(passkey, salt = sha256("zeitgeist.calls.v1"))   one prompt per session, memory only
//   callKey = HKDF-SHA256(root, info = "zeitgeist.call:" || callId)     32 bytes, unique per call
//   sealed  = nonce(12) || AES-256-GCM(callKey, plaintext)
//
// The account key uses Mera's default salt; this is a separate PRF namespace, so the calls root is
// unrelated to the account key. Revealing one callKey (on-chain) opens that call and nothing else,
// since HKDF outputs for different call ids are independent. AES-GCM's tag makes a reveal
// self-verifying: a wrong key cannot open the ciphertext.
import { getPasskeyPrfOutput, type PasskeyCredentialMetadata } from "@category-labs/mera";
import { bytesToHex, hexToBytes, type Hex } from "viem";

const enc = new TextEncoder();
export const CALLS_SALT_LABEL = "zeitgeist.calls.v1";

export type CallPlain = { v: 1; category: string; key: string; dir: "up" | "down"; note?: string };

async function sha256(s: string) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)));
}

/** One passkey prompt: the root of every call key. Keep it in memory only. */
export async function unlockCallsRoot(credential?: PasskeyCredentialMetadata): Promise<Uint8Array> {
  const r = await getPasskeyPrfOutput({ rpId: window.location.hostname, credential, prfSalt: await sha256(CALLS_SALT_LABEL) });
  return new Uint8Array(r.prfOutput);
}

export async function callKey(root: Uint8Array, callId: Hex): Promise<Uint8Array> {
  const ikm = await crypto.subtle.importKey("raw", root as BufferSource, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: enc.encode(`zeitgeist.call:${callId.toLowerCase()}`) },
    ikm, 256,
  );
  return new Uint8Array(bits);
}

const aes = (k: Uint8Array) => crypto.subtle.importKey("raw", k as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);

export async function sealCall(key: Uint8Array, plain: CallPlain): Promise<Hex> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, await aes(key), enc.encode(JSON.stringify(plain))));
  const out = new Uint8Array(12 + ct.length);
  out.set(nonce);
  out.set(ct, 12);
  return bytesToHex(out);
}

/** Opens a sealed call; returns null if the key is wrong (GCM tag fails) or the payload is malformed. */
export async function openCall(key: Uint8Array | Hex, sealed: Hex): Promise<CallPlain | null> {
  try {
    const k = typeof key === "string" ? hexToBytes(key) : key;
    const b = hexToBytes(sealed);
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b.slice(0, 12) }, await aes(k), b.slice(12));
    const p = JSON.parse(new TextDecoder().decode(pt));
    return p?.v === 1 && (p.dir === "up" || p.dir === "down") ? (p as CallPlain) : null;
  } catch {
    return null;
  }
}

export const newCallId = (): Hex => bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
