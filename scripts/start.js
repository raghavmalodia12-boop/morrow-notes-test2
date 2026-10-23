// One command for everything: `npm start`
// - installs dependencies if missing, builds the client if missing/outdated, then starts the server.
// - On Render the build step has already done the first two, so this just starts the server.
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import readline from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const server = join(root, "server");
const client = join(root, "client");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

function run(args, cwd) {
  const r = spawnSync(npm, args, { cwd, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status || 1);
}
function newestMtime(path) {
  if (!existsSync(path)) return 0;
  const st = statSync(path);
  if (!st.isDirectory()) return st.mtimeMs;
  return Math.max(0, ...readdirSync(path).map(f => newestMtime(join(path, f))));
}

// ---------- first-run setup (local only) ----------
const hosted = Boolean(process.env.RENDER || process.env.FIREBASE_SERVICE_ACCOUNT_JSON);

function askHidden(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = str => { if (str.includes(question)) rl.output.write(str); };
    rl.question(question, answer => { rl.close(); process.stdout.write("\n"); resolve(answer.trim()); });
  });
}

const DEFAULT_USER = "raghavmalodia12_db_user";
const DEFAULT_HOST = "cluster-morrow-notes.vmiegno.mongodb.net";
const uriTemplate = (user, host) => `mongodb+srv://${user}:YOUR_PASSWORD@${host}/morrow_notes?retryWrites=true&w=majority&appName=cluster-morrow-notes`;

// Repairs the usual hand-editing mistakes in an Atlas URI: stray quotes/<>, a :port on a +srv host,
// and unencoded special characters in the password.
function fixMongoUri(raw) {
  let uri = raw.trim().replace(/^["']|["']$/g, "");
  const m = uri.match(/^(mongodb(?:\+srv)?:\/\/)([^:@\/]+):(.*)@([^@\/?]+)(.*)$/);
  if (!m) return uri;
  let [, scheme, user, pass, host, rest] = m;
  pass = pass.replace(/^<|>$/g, "");
  if (scheme === "mongodb+srv://") host = host.replace(/:\d+$/, "");
  let plain = pass;
  try { plain = decodeURIComponent(pass); } catch {}
  return `${scheme}${user}:${encodeURIComponent(plain)}@${host}${rest}`;
}

async function ensureMongoPassword() {
  const envPath = join(server, ".env");
  const reset = process.argv.includes("--reset-db");
  let text = existsSync(envPath) ? readFileSync(envPath, "utf8") : "PORT=5002\n";
  const line = text.match(/^MONGODB_URI=(.*)$/m);

  if (line && !reset && !line[1].includes("YOUR_PASSWORD")) {
    const fixed = fixMongoUri(line[1]);
    if (fixed !== line[1].trim()) { writeFileSync(envPath, text.replace(/^MONGODB_URI=.*$/m, () => `MONGODB_URI=${fixed}`)); console.log("\nTidied the MONGODB_URI line in server/.env\n"); }
    return;
  }

  if (!process.stdin.isTTY) { console.error("Set the Atlas password in server/.env (replace YOUR_PASSWORD)."); process.exit(1); }
  const old = line?.[1]?.match(/^mongodb\+srv:\/\/([^:@\/]+):.*@([^@\/?:]+)/);
  const user = old?.[1] || DEFAULT_USER;
  const host = old?.[2] || DEFAULT_HOST;
  console.log(`\n${reset ? "Re-entering" : "First run:"} the MongoDB Atlas password for ${user} (saved only in server/.env on this computer).`);
  const answer = await askHidden("Atlas database password (or paste the full connection string): ");
  if (!answer) { console.error("Nothing entered."); process.exit(1); }
  const uri = /^mongodb(\+srv)?:\/\//.test(answer) ? fixMongoUri(answer) : uriTemplate(user, host).replace("YOUR_PASSWORD", encodeURIComponent(answer));
  const next = line ? text.replace(/^MONGODB_URI=.*$/m, () => `MONGODB_URI=${uri}`) : `${text.trimEnd()}\nMONGODB_URI=${uri}\n`;
  writeFileSync(envPath, next);
  console.log("Saved to server/.env\n");
}

function ensureFirebaseKey() {
  const target = join(server, "firebase-service-account.json");
  if (existsSync(target)) return;
  let wantedProject = "";
  try { wantedProject = readFileSync(join(client, ".env"), "utf8").match(/^VITE_FIREBASE_PROJECT_ID=(.*)$/m)?.[1]?.trim() || ""; } catch {}
  const folders = [root, client, join(homedir(), "Downloads"), join(homedir(), "Desktop")];
  const candidates = [];
  for (const dir of folders) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!/\.json$/i.test(f) || !/(firebase|adminsdk|service-account|serviceaccount)/i.test(f)) continue;
      const full = join(dir, f);
      try {
        const j = JSON.parse(readFileSync(full, "utf8"));
        if (j.type === "service_account" && j.private_key && (!wantedProject || j.project_id === wantedProject)) candidates.push({ full, at: statSync(full).mtimeMs });
      } catch {}
    }
  }
  candidates.sort((a, b) => b.at - a.at);
  if (candidates[0]) { copyFileSync(candidates[0].full, target); console.log(`\nFound your Firebase key (${candidates[0].full}) and copied it to server/firebase-service-account.json\n`); }
}

if (!hosted) { await ensureMongoPassword(); ensureFirebaseKey(); }

if (!existsSync(join(server, "node_modules", "express"))) { console.log("\nInstalling server dependencies...\n"); run(["install"], server); }

const dist = join(client, "dist", "index.html");
const builtAt = existsSync(dist) ? statSync(dist).mtimeMs : 0;
const sourceAt = Math.max(newestMtime(join(client, "src")), newestMtime(join(client, ".env")), newestMtime(join(client, "index.html")));
if (!builtAt || sourceAt > builtAt) {
  if (!existsSync(join(client, "node_modules", "vite"))) { console.log("\nInstalling client dependencies...\n"); run(["install", "--include=dev"], client); }
  console.log("\nBuilding the client...\n");
  run(["run", "build"], client);
}

if (!hosted && !existsSync(join(server, "firebase-service-account.json"))) {
  console.warn("\n⚠  No Firebase key found. Download one (Firebase Console > Project settings > Service accounts > Generate new private key), put it in this folder or Downloads, and run npm start again.\n");
  process.exit(1);
}

const r = spawnSync(process.execPath, ["src/index.js"], { cwd: server, stdio: "inherit" });
process.exit(r.status ?? 0);
