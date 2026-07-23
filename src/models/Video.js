import mongoose from "mongoose";
import Counter from "./Counter.js";

const videoSchema = new mongoose.Schema(
  {
    videoId: {
      type: String,
      unique: true,
      trim: true,
    },

    title: {
      type: String,
      required: [true, "Video title is required"],
      trim: true,
    },

    veedUrl: {
      type: String,
      default: "",
      trim: true,
    },

    vimeoId: {
      type: String,
      default: "",
      trim: true,
    },

    designation: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Designation",
      },
    ],

    sortOrder: {
      type: Number,
      default: 1,
    },

    duration: {
      type: String,
      default: "",
    },

    thumbnail: {
      type: String,
      default: "",
      trim: true,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  },
);

// Auto-increment Video ID before saving
videoSchema.pre("save", async function () {
  if (!this.isNew || this.videoId) return;

  const counter = await Counter.findOneAndUpdate(
    { _id: "video" },
    { $inc: { seq: 1 } },
    {
      new: true, // Legacy compatibility alias for returnDocument: 'after'
      upsert: true,
    },
  );

  this.videoId = `VID-${String(counter.seq).padStart(3, "0")}`;
});

export default mongoose.model("Video", videoSchema);
