import mongoose from "mongoose";
import { Readable } from "node:stream";
import { Router } from "express";

// Uploaded files (avatars, note images, attachments) are stored in MongoDB GridFS
// instead of on local disk, because hosts like Render wipe the disk on every deploy.
// Public URLs keep the same shape as before: /uploads/<folder>/<filename>.

let bucket;
function getBucket() {
  if (!bucket) bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: "uploads" });
  return bucket;
}

export function saveFile(key, file) {
  return new Promise((resolve, reject) => {
    const stream = getBucket().openUploadStream(key, {
      metadata: { contentType: file.mimetype, originalName: file.originalname }
    });
    stream.on("error", reject);
    stream.on("finish", () => resolve(key));
    Readable.from(file.buffer).pipe(stream);
  });
}

const INLINE = /^(image\/(jpeg|png|webp|gif)|application\/pdf|text\/plain)$/;
const TYPES = {
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif",
  ".pdf": "application/pdf", ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8", ".csv": "text/csv; charset=utf-8",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation"
};

export const uploadsRouter = Router();

uploadsRouter.get("/:folder/:name", async (req, res, next) => {
  try {
    const { folder, name } = req.params;
    if (!["avatars", "notes"].includes(folder) || !/^[\w.-]+$/.test(name)) return res.status(404).end();
    const key = `${folder}/${name}`;
    const [doc] = await getBucket().find({ filename: key }).sort({ uploadDate: -1 }).limit(1).toArray();
    if (!doc) return res.status(404).end();
    const ext = name.slice(name.lastIndexOf(".")).toLowerCase();
    const type = TYPES[ext] || "application/octet-stream";
    res.set({
      "Content-Type": type,
      "Content-Length": doc.length,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=31536000, immutable",
      "Content-Disposition": INLINE.test(type.split(";")[0]) ? "inline" : "attachment"
    });
    getBucket().openDownloadStreamByName(key).on("error", next).pipe(res);
  } catch (error) { next(error); }
});
