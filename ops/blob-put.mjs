// Upload keeper outputs to Vercel Blob under stable names (overwriting), e.g.
//   BLOB_READ_WRITE_TOKEN=... node ops/blob-put.mjs indexer/out/latest.json:data/snapshot.json ...
// Prints each public URL. Used by the GitHub Actions keeper.
import fs from "node:fs";
import { put } from "@vercel/blob";

for (const arg of process.argv.slice(2)) {
  const [src, pathname] = arg.split(":");
  const r = await put(pathname, fs.readFileSync(src), {
    access: "public", addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60,
    contentType: pathname.endsWith(".json") ? "application/json" : "application/octet-stream",
  });
  console.log(r.url);
}
