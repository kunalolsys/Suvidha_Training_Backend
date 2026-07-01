import mongoose from "mongoose";

const attemptSchema = new mongoose.Schema(
  {
    score: Number,

    totalQuestions: Number,

    answers: [
      {
        question: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Question",
        },

        selectedOption: Number,
      },
    ],

    passed: Boolean,

    attemptedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    _id: false,
  },
);

const progressSchema = new mongoose.Schema(
  {
    employee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    video: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Video",
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

export default mongoose.model("Progress", progressSchema);
