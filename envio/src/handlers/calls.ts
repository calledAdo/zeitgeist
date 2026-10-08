// Sealed calls: store the ciphertext, then decrypt it when the caller reveals that call's key.
import { indexer } from "envio";
import { webcrypto } from "node:crypto";

// bytes16 arrives right-padded to 32 bytes; keep the 16-byte id the contract uses
const callIdOf = (b: string) => b.slice(0, 34).toLowerCase();
const hex = (h: string) => Uint8Array.from(Buffer.from(h.slice(2), "hex"));

async function open(key: string, sealed: string) {
  try {
    const b = hex(sealed);
    const k = await webcrypto.subtle.importKey("raw", hex(key), "AES-GCM", false, ["decrypt"]);
    const pt = await webcrypto.subtle.decrypt({ name: "AES-GCM", iv: b.slice(0, 12) }, k, b.slice(12));
    const p = JSON.parse(Buffer.from(pt).toString("utf8"));
    return p?.v === 1 && (p.dir === "up" || p.dir === "down") ? p : null;
  } catch {
    return null;
  }
}

indexer.onEvent({ contract: "SealedCalls", event: "Sealed" }, async ({ event, context }) => {
  context.Call.set({
    id: callIdOf(event.params.callId),
    caller: event.params.caller.toLowerCase(),
    sealedAt: event.block.timestamp,
    horizonEnd: Number(event.params.horizonEnd),
    ciphertext: event.params.ciphertext,
    revealed: false,
    key: undefined,
    opened: false,
    category: undefined,
    entityKey: undefined,
    direction: undefined,
    note: undefined,
    revealedAt: undefined,
  });
});

indexer.onEvent({ contract: "SealedCalls", event: "Revealed" }, async ({ event, context }) => {
  const c = await context.Call.getOrThrow(callIdOf(event.params.callId));
  const p = await open(event.params.key, c.ciphertext);
  context.Call.set({
    ...c,
    revealed: true,
    key: event.params.key,
    opened: p !== null,
    category: p?.category,
    entityKey: p?.key,
    direction: p?.dir,
    note: typeof p?.note === "string" ? p.note.slice(0, 280) : undefined,
    revealedAt: event.block.timestamp,
  });
});
