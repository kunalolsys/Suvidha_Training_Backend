import mongoose from "mongoose";

const storeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    code: {
      type: String,
      unique: true,
      sparse: true,
    },

    address: String,
  },
  {
    timestamps: true,
  },
);

export default mongoose.model("Store", storeSchema);
