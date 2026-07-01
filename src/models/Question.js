import mongoose from "mongoose";

const questionSchema = new mongoose.Schema(
  {
    video: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Video",
    },

    question: String,

    options: [
      {
        option: String,
        isCorrect: Boolean,
      },
    ],

    sortOrder: Number,
  },
  {
    timestamps: true,
  },
);

export default mongoose.model("Question", questionSchema);
