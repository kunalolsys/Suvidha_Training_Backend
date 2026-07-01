import mongoose from "mongoose";

const storeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },

    code: {
      type: String,
      unique: true,
    },

    address: String,
  },
  {
    timestamps: true,
  },
);

export default mongoose.model("Store", storeSchema);
