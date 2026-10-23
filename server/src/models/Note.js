import mongoose from "mongoose";

const noteSchema = new mongoose.Schema({
  ownerUid: { type: String, required: true, index: true },
  title: { type: String, trim: true, maxlength: 120, default: "Untitled note" },
  content: { type: String, trim: true, maxlength: 300000, default: "" },
  pinned: { type: Boolean, default: false },
  color: { type: String, enum: ["yellow", "blue", "pink", "green", "purple"], default: "yellow" }
}, { timestamps: true });

noteSchema.index({ ownerUid: 1, updatedAt: -1 });
export default mongoose.model("Note", noteSchema);
