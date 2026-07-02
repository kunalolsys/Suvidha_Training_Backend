import mongoose from "mongoose";
import Counter from "./Counter.js";

const videoSchema = new mongoose.Schema(
  {
    videoId: {
      type: String,
      unique: true,
    },

    title: String,

    veedUrl: String,

    designation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Designation",
    },

    sortOrder: Number,

    duration: String,

    thumbnail: String,

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  },
);
videoSchema.pre("save", async function () {
  if (!this.isNew || this.videoId) return;

  const counter = await Counter.findOneAndUpdate(
    { _id: "video" },
    { $inc: { seq: 1 } },
    {
      upsert: true,
      returnDocument: "after",
    },
  );

  this.videoId = `VID-${String(counter.seq).padStart(3, "0")}`;
});

export default mongoose.model("Video", videoSchema);
