// Writes config.<target>.json from a contracts deployment file.
//   node gen-config.mjs local   31337 http://localhost:3000/targets.json
//   node gen-config.mjs testnet 10143 https://<your-app>/targets.json
//   node gen-config.mjs fork 10143-fork http://localhost:3000/targets.json   (anvil fork of Monad testnet)
import fs from "node:fs";
import path from "node:path";
const [target, chainId, targetsUrl] = process.argv.slice(2);
if (!target || !chainId || !targetsUrl) throw new Error("usage: node gen-config.mjs <target> <chainId> <targetsUrl>");
const here = path.dirname(new URL(import.meta.url).pathname);
const dep = JSON.parse(fs.readFileSync(path.resolve(here, `../../contracts/deployments/${chainId}.json`), "utf8"));
const keys = ["geopolitics", "tech_companies", "tech_personalities"].filter((k) => dep[k]);
const cfg = {
  schedule: "0 */15 * * * *",
  chainSelectorName: "monad-testnet",
  targetsUrl,
  gdeltLastUpdateUrl: "https://data.gdeltproject.org/gdeltv2/lastupdate.txt",
  receiver: dep.receiver,
  oracle: dep.oracle,
  markets: Object.fromEntries(keys.map((k) => [k, dep[k]])),
  maxLagMinutes: 45,
  gasLimit: "6000000",
};
fs.writeFileSync(path.join(here, `config.${target}.json`), JSON.stringify(cfg, null, 2) + "\n");
console.log(`wrote config.${target}.json (receiver ${dep.receiver})`);
