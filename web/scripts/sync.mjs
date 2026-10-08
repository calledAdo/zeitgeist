// Pulls contract ABIs, deployment addresses and the latest oracle snapshot into the app.
import fs from "node:fs";
import path from "node:path";
const here = import.meta.dirname;
const root = path.resolve(here, "../..");
const gen = path.resolve(here, "../src/generated");
fs.mkdirSync(gen, { recursive: true });
const abis = {};
for (const c of ["CategoryMarket", "EntityToken", "EntityGauge", "CategoryVoter", "VotingEscrow", "Zeit", "TestUSDC", "Minter", "SealedCalls"]) {
  abis[c] = JSON.parse(fs.readFileSync(`${root}/contracts/out/${c}.sol/${c}.json`, "utf8")).abi;
}
fs.writeFileSync(`${gen}/abis.json`, JSON.stringify(abis));
const chain = process.env.NEXT_PUBLIC_CHAIN_ID ?? "31337";
const dep = `${root}/contracts/deployments/${chain}.json`;
fs.writeFileSync(`${gen}/deployment.json`, fs.existsSync(dep) ? fs.readFileSync(dep) : "{}");
fs.copyFileSync(`${root}/contracts/script/entities.json`, `${gen}/manifest.json`);
const snap = `${root}/indexer/out/latest.json`;
if (fs.existsSync(snap)) fs.copyFileSync(snap, path.resolve(here, "../public/snapshot.json"));
const tgt = path.join(path.dirname(snap), "targets.json");
if (fs.existsSync(tgt)) fs.copyFileSync(tgt, path.resolve(here, "../public/targets.json")); // fetched by the Chainlink CRE workflow
console.log(`sync: ABIs, deployment ${chain}${fs.existsSync(dep) ? "" : " (missing)"}, snapshot ${fs.existsSync(snap) ? "ok" : "missing"}`);
