import mongoose from "mongoose";

const userSchema = new mongoose.Schema({
  firebaseUid: { type: String, required: true, unique: true, index: true },
  email: { type: String, default: "" },
  displayName: { type: String, default: "" },
  avatarUrl: { type: String, default: "" },
  theme: { type: String, enum: ["light", "dark"], default: "light" }
}, { timestamps: true });

export default mongoose.model("User", userSchema);
