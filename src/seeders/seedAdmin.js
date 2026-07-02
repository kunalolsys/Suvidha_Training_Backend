import dotenv from "dotenv";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
dotenv.config();
const seedAdminUser = async () => {
  try {
    const url = process.env.MONGO_URI;
    // 1. Connect to your MongoDB instance
    // console.log(url);
    await mongoose.connect(url);
    console.log("Database connected successfully for seeding...");

    // 2. Check if an admin already exists to prevent duplicate entries
    const adminExists = await User.findOne({ role: "Admin" });
    if (adminExists) {
      console.log("An Admin user already exists in the database.");
      process.exit(0);
    }

    // 3. Hash the admin password securely
    const hashedPassword = await bcrypt.hash(
      process.env.ADMIN_USER_PASSWORD || "jAOa5WWnv!0f*5Ng",
      10,
    );

    // 4. Insert the master admin document
    const masterAdmin = await User.create({
      employeeId: process.env.ADMIN_ECODE || "Admin001",
      name: process.env.ADMIN_USER_NAME || "Admin",
      email: process.env.ADMIN_USER_EMAIL || "admin@openlogicsys.com",
      password: hashedPassword,
      role: "Admin",
      isActive: true,
    });

    console.log(
      `Success: Admin user created successfully (${masterAdmin.email})`,
    );
    process.exit(0);
  } catch (error) {
    console.error("Error seeding the admin user:", error.message);
    process.exit(1);
  }
};

seedAdminUser();
