import { Router } from "express";
import multer from "multer";
import path from "node:path";
import crypto from "node:crypto";
import User from "../models/User.js";
import { verifyFirebase } from "../middleware/verifyFirebase.js";
import { saveFile } from "../lib/storage.js";

const router = Router();
router.use(verifyFirebase);

async function getOrCreateUser(req) {
  const { uid, email, name, picture } = req.user;
  // Google's name and photo are only the starting values. After the account exists,
  // changes made in the app must never be overwritten on the next load.
  return User.findOneAndUpdate(
    { firebaseUid: uid },
    {
      $setOnInsert: { firebaseUid: uid, ...(name ? { displayName: name } : {}), ...(picture ? { avatarUrl: picture } : {}) },
      $set: { email }
    },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
  );
}

router.get("/me", async (req, res, next) => {
  try {
    const user = await getOrCreateUser(req);
    res.json({ id: user._id, email: user.email, displayName: user.displayName, avatarUrl: user.avatarUrl, theme: user.theme });
  } catch (error) { next(error); }
});

router.patch("/me", async (req, res, next) => {
  try {
    const updates = {};
    if (typeof req.body.displayName === "string") updates.displayName = req.body.displayName.trim().slice(0, 80);
    if (["light", "dark"].includes(req.body.theme)) updates.theme = req.body.theme;
    const user = await User.findOneAndUpdate(
      { firebaseUid: req.user.uid },
      { $setOnInsert: { firebaseUid: req.user.uid, email: req.user.email }, $set: updates },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );
    res.json({ id: user._id, email: user.email, displayName: user.displayName, avatarUrl: user.avatarUrl, theme: user.theme });
  } catch (error) { next(error); }
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/gif"];
    cb(allowed.includes(file.mimetype) ? null : new Error("Use a JPG, PNG, WEBP, or GIF image."), allowed.includes(file.mimetype));
  }
});

router.post("/me/avatar", (req, res, next) => {
  upload.single("avatar")(req, res, async (error) => {
    if (error) return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ message: error.code === "LIMIT_FILE_SIZE" ? "Avatar must be 10 MB or smaller." : error.message });
    if (!req.file) return res.status(400).json({ message: "Choose an image to upload." });
    try {
      const filename = `${req.user.uid.replace(/[^a-zA-Z0-9_-]/g, "_")}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${path.extname(req.file.originalname).toLowerCase()}`;
      await saveFile(`avatars/${filename}`, req.file);
      const avatarUrl = `/uploads/avatars/${filename}`;
      const user = await User.findOneAndUpdate(
        { firebaseUid: req.user.uid },
        { $setOnInsert: { firebaseUid: req.user.uid, email: req.user.email }, $set: { avatarUrl } },
        { new: true, upsert: true, runValidators: true }
      );
      res.json({ avatarUrl: user.avatarUrl });
    } catch (e) { next(e); }
  });
});

export default router;
