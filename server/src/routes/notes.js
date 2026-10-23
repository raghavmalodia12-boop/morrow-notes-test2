import { Router } from "express";
import mongoose from "mongoose";
import multer from "multer";
import path from "node:path";
import crypto from "node:crypto";
import Note from "../models/Note.js";
import { verifyFirebase } from "../middleware/verifyFirebase.js";
import { cleanContent } from "../lib/cleanHtml.js";
import { saveFile } from "../lib/storage.js";

const router = Router();
router.use(verifyFirebase);

const imgUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const ok = ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.mimetype);
    cb(ok ? null : new Error("Use a JPG, PNG, WEBP, or GIF image."), ok);
  }
});

router.post("/image", (req, res) => {
  imgUpload.single("image")(req, res, async error => {
    if (error) return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ message: error.code === "LIMIT_FILE_SIZE" ? "Image must be 10 MB or smaller." : error.message });
    if (!req.file) return res.status(400).json({ message: "Choose an image to upload." });
    try {
      const filename = `${req.user.uid.replace(/[^a-zA-Z0-9_-]/g, "_")}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${path.extname(req.file.originalname).toLowerCase()}`;
      await saveFile(`notes/${filename}`, req.file);
      res.status(201).json({ url: `/uploads/notes/${filename}` });
    } catch (e) { console.error(e); res.status(500).json({ message: "Couldn't save that image." }); }
  });
});

router.get("/", async (req, res, next) => {
  try {
    const search = String(req.query.search || "").trim();
    const filter = { ownerUid: req.user.uid };
    if (search) filter.$or = [
      { title: { $regex: escapeRegex(search), $options: "i" } },
      { content: { $regex: escapeRegex(search), $options: "i" } }
    ];
    res.json(await Note.find(filter).sort({ pinned: -1, updatedAt: -1 }).limit(500));
  } catch (error) { next(error); }
});

router.post("/", async (req, res, next) => {
  try {
    const title = typeof req.body.title === "string" ? req.body.title.trim() : "";
    const content = cleanContent(req.body.content);
    const color = ["yellow", "blue", "pink", "green", "purple"].includes(req.body.color) ? req.body.color : "yellow";
    if (!title && !content) return res.status(400).json({ message: "Add a title or some note text first." });
    const note = await Note.create({ ownerUid: req.user.uid, title: title || "Untitled note", content, color, pinned: req.body.pinned === true });
    res.status(201).json(note);
  } catch (error) { next(error); }
});

router.put("/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid note ID." });
    const updates = {};
    if (typeof req.body.title === "string") updates.title = req.body.title.trim() || "Untitled note";
    if (typeof req.body.content === "string") updates.content = cleanContent(req.body.content);
    if (typeof req.body.pinned === "boolean") updates.pinned = req.body.pinned;
    if (["yellow", "blue", "pink", "green", "purple"].includes(req.body.color)) updates.color = req.body.color;
    const note = await Note.findOneAndUpdate({ _id: req.params.id, ownerUid: req.user.uid }, updates, { new: true, runValidators: true });
    if (!note) return res.status(404).json({ message: "Note not found." });
    res.json(note);
  } catch (error) { next(error); }
});

router.delete("/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid note ID." });
    const note = await Note.findOneAndDelete({ _id: req.params.id, ownerUid: req.user.uid });
    if (!note) return res.status(404).json({ message: "Note not found." });
    res.json({ message: "Note deleted." });
  } catch (error) { next(error); }
});

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");
}
export default router;
