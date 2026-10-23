import admin from "firebase-admin";
import { readFileSync } from "node:fs";

function loadServiceAccount() {
  // Preferred for hosting: paste the whole service-account JSON (or its base64) into FIREBASE_SERVICE_ACCOUNT_JSON.
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (raw) return JSON.parse(raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8"));
  // Local development: a JSON file on disk.
  const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || "./firebase-service-account.json";
  return JSON.parse(readFileSync(serviceAccountPath, "utf8"));
}

export function ensureFirebaseAdmin() {
  if (admin.apps.length) return;
  try {
    admin.initializeApp({ credential: admin.credential.cert(loadServiceAccount()) });
  } catch (error) {
    throw new Error(`Firebase Admin setup failed. Set FIREBASE_SERVICE_ACCOUNT_JSON (hosting) or add server/firebase-service-account.json (local). ${error.message}`);
  }
}

export async function verifyFirebase(req, res, next) {
  try {
    if (!admin.apps.length) ensureFirebaseAdmin();
  } catch (error) {
    console.error(error.message);
    return res.status(500).json({ message: "The server isn't connected to Firebase yet. Set FIREBASE_SERVICE_ACCOUNT_JSON for this project and restart." });
  }
  try {
    const header = req.headers.authorization || "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) return res.status(401).json({ message: "Sign in to continue." });
    const decoded = await admin.auth().verifyIdToken(match[1]);
    req.user = { uid: decoded.uid, email: decoded.email || "", name: decoded.name || "", picture: decoded.picture || "" };
    next();
  } catch (error) {
    console.error("Authentication failed:", error.message);
    const wrongProject = /aud|audience|project/i.test(error.message);
    res.status(401).json({ message: wrongProject
      ? "The server's Firebase key is from a different project than the app. Download a new key from the morrow-notes-app project and restart."
      : "Your session could not be verified. Please sign in again." });
  }
}
