import mongoose from "mongoose";

const videoSchema = new mongoose.Schema(
  {
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

export default mongoose.model("Video", videoSchema);
