import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    employeeId: {
      type: String,
      unique: true,
    },

    name: {
      type: String,
      required: true,
    },

    email: {
      type: String,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
    },

    role: {
      type: String,
      enum: ["Admin", "Employee"],
      default: "Employee",
    },

    designation: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Designation",
    },

    store: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Store",
    },

    avatar: String,

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  },
);
userSchema.index(
  { email: 1 },
  {
    unique: true,
    partialFilterExpression: {
      email: { $exists: true, $type: "string" },
    },
  },
);
export default mongoose.model("User", userSchema);
