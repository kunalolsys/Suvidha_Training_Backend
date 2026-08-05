// models/Progress.js
import mongoose from "mongoose";

// Snapshot of each question & answer at the exact time of the quiz attempt
const questionSnapshotSchema = new mongoose.Schema(
  {
    questionId: String,
    questionText: String,
    options: [
      {
        optionText: String,
        isCorrect: Boolean,
      },
    ],
    selectedOptionIndex: Number,
    isCorrect: Boolean,
  },
  { _id: false },
);

// Individual quiz attempt record
const attemptSchema = new mongoose.Schema(
  {
    score: Number,
    totalQuestions: Number,
    passed: Boolean,
    attemptedAt: {
      type: Date,
      default: Date.now,
    },
    // Complete, tamper-proof snapshot for certification audit trails
    snapshot: [questionSnapshotSchema],
  },
  { _id: false },
);

const progressSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    video: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Video",
      required: true,
    },
    designation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Designation",
    },
    // Freeze video metadata on completion so sort order/title changes don't affect past records
    videoSnapshot: {
      title: String,
      sortOrder: Number,
      duration: String,
      designationName: String, // <-- designation snapshot (optional for display)
    },
    status: {
      type: String,
      enum: ["locked", "unlocked", "completed"],
      default: "locked",
    },

    attempts: {
      type: Number,
      default: 0,
    },

    completedAt: Date,

    history: [attemptSchema],
  },
  {
    timestamps: true,
  },
);

// Compound index to ensure 1 progress doc per user/video
progressSchema.index({ employee: 1, video: 1 }, { unique: true });

export default mongoose.model("Progress", progressSchema);
