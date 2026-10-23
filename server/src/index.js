import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import mongoose from "mongoose";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import notesRouter from "./routes/notes.js";
import usersRouter from "./routes/users.js";
import attachmentsRouter from "./routes/attachments.js";
import { verifyFirebase } from "./middleware/verifyFirebase.js";
import { uploadsRouter } from "./lib/storage.js";

dotenv.config();
const app = express();
const port = Number(process.env.PORT) || 5002;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.resolve(__dirname, "../../client/dist");
const clientOrigins = (process.env.CLIENT_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173").split(",").map(s => s.trim()).filter(Boolean);

app.disable("x-powered-by");
app.use(cors({ origin: clientOrigins }));
app.use(express.json({ limit: "2mb" }));
app.get("/api/health", (_req, res) => res.json({ status: "ok", database: mongoose.connection.readyState === 1 ? "connected" : "disconnected" }));
app.use("/uploads", uploadsRouter);
app.use("/api/notes", notesRouter);
app.use("/api/users", usersRouter);
app.use("/api/attachments", verifyFirebase, attachmentsRouter);

// In production the API also serves the built React app, so one service hosts everything.
if (existsSync(clientDist)) {
  app.use(express.static(clientDist, { index: false, maxAge: "1h" }));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api/") || req.path.startsWith("/uploads/")) return next();
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ message: "Something went wrong on the server." });
});

async function start() {
  if (!process.env.MONGODB_URI) {
    console.error("Missing MONGODB_URI. Set it in the host's environment variables (or copy .env.example to .env locally).");
    process.exit(1);
  }
  try {
    await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
    console.log("MongoDB connected");
    app.listen(port, "0.0.0.0", () => console.log(`Morrow Notes running on port ${port}`));
  } catch (error) {
    console.error("Could not connect to MongoDB:", error.message);
    if (/auth/i.test(error.message)) console.error("-> Wrong Atlas username/password. Fix MONGODB_URI in server/.env.");
    else console.error("-> In Atlas open Security > Network Access and allow 0.0.0.0/0, and check your internet connection.");
    process.exit(1);
  }
}
start();
