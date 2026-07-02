import mongoose from "mongoose";
import Counter from "./Counter.js";

const questionSchema = new mongoose.Schema(
  {
    questionId: {
      type: String,
      unique: true,
    },

    video: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Video",
      required: true,
    },

    question: {
      type: String,
      required: true,
    },

    options: [
      {
        option: {
          type: String,
          required: true,
        },
        isCorrect: {
          type: Boolean,
          default: false,
        },
      },
    ],

    sortOrder: {
      type: Number,
      required: true,
    },
  },
  {
    timestamps: true,
  },
);

questionSchema.pre("save", async function () {
  if (!this.isNew || this.questionId) return;

  const counter = await Counter.findOneAndUpdate(
    { _id: "question" },
    { $inc: { seq: 1 } },
    {
      upsert: true,
      returnDocument: "after",
    },
  );

  this.questionId = `QUE-${String(counter.seq).padStart(3, "0")}`;
});

export default mongoose.model("Question", questionSchema);
