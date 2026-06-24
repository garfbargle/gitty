import fs from "fs";

const tag = process.argv[2];
if (!tag?.startsWith("v")) {
  console.error("Usage: node scripts/sync-version-from-tag.mjs v1.2.3");
  process.exit(1);
}

const version = tag.slice(1);

const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
packageJson.version = version;
fs.writeFileSync("package.json", `${JSON.stringify(packageJson, null, 2)}\n`);

const tauriConfig = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json", "utf8"));
tauriConfig.version = version;
fs.writeFileSync("src-tauri/tauri.conf.json", `${JSON.stringify(tauriConfig, null, 2)}\n`);

const cargoToml = fs.readFileSync("src-tauri/Cargo.toml", "utf8");
if (!/^version = "/m.test(cargoToml)) {
  console.error("Could not find version field in src-tauri/Cargo.toml");
  process.exit(1);
}
fs.writeFileSync(
  "src-tauri/Cargo.toml",
  cargoToml.replace(/^version = ".*"/m, `version = "${version}"`),
);

console.log(`Synced app version to ${version} from tag ${tag}`);
