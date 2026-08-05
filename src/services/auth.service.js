import bcrypt from "bcryptjs";
import User from "../models/User.js";
import ApiError from "../utils/ApiError.js";
import generateToken from "../utils/generateToken.js";
import csvParser from "csv-parser";
import { Readable } from "stream";
import mongoose from "mongoose";

export const register = async (body) => {
  const { name, email, password, role, designation, store, employeeId } = body;

  const existingUser = await User.findOne({
    email: email.toLowerCase(),
  });

  if (existingUser) {
    throw new ApiError(409, "Email already exists");
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const user = await User.create({
    name,
    email: email.toLowerCase(),
    password: hashedPassword,
    role,
    designation,
    store,
    employeeId,
  });

  const token = generateToken(user);

  return {
    token,
    user,
  };
};

export const login = async ({ userName, password, role }) => {
  if (!userName) {
    throw new ApiError(400, "Email or Employee ID is required");
  }

  if (!role) {
    throw new ApiError(400, "Role is required");
  }

  // 🔒 Admin Password Validation Check
  if (role === "Admin" && !password) {
    throw new ApiError(400, "Password is required for Admin login");
  }

  const user = await User.findOne({
    $or: [{ email: userName.toLowerCase() }, { employeeId: userName }],
    isActive: true,
  })
    .select("+password") // Explicitly include password if schema has select: false
    .populate("designation")
    .populate("store");

  if (!user) {
    throw new ApiError(401, "Invalid Email or Employee ID");
  }

  // Check role
  if (user.role !== role) {
    throw new ApiError(
      403,
      `This account is not authorized to log in as ${role}.`,
    );
  }

  // 🔒 Verify Password ONLY for Admin
  if (role === "Admin") {
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      throw new ApiError(401, "Invalid password");
    }
  }

  const token = generateToken(user);

  user.password = undefined;

  return {
    token,
    user,
  };
};

export const profile = async (userId) => {
  const user = await User.findById(userId)
    .populate("designation")
    .populate("store")
    .select("-password");

  if (!user) {
    throw new ApiError(404, "User not found");
  }

  return user;
};

export const changePassword = async (userId, oldPassword, newPassword) => {
  const user = await User.findById(userId);

  if (!user) {
    throw new ApiError(404, "User not found");
  }

  const match = await bcrypt.compare(oldPassword, user.password);

  if (!match) {
    throw new ApiError(400, "Old password is incorrect");
  }

  user.password = await bcrypt.hash(newPassword, 10);

  await user.save();

  return true;
};

// 🟢 NEW: Update Admin Profile Details (Name, Email, Phone, Avatar)
export const updateProfile = async (userId, updateData) => {
  const { name, email, avatar } = updateData;

  const user = await User.findById(userId);

  if (!user) {
    throw new ApiError(404, "User not found");
  }

  const updates = {};

  // Check for email collision if email is being updated
  if (email && email.toLowerCase() !== user.email) {
    const existingEmail = await User.findOne({
      email: email.toLowerCase(),
      _id: { $ne: userId },
    });

    if (existingEmail) {
      throw new ApiError(409, "Email is already taken by another user");
    }
    updates.email = email.toLowerCase();
  }

  if (name) updates.name = name;
  if (avatar !== undefined) updates.avatar = avatar;

  // Perform update without triggering 'password required' validation on save
  const updatedUser = await User.findByIdAndUpdate(
    userId,
    { $set: updates },
    { new: true, runValidators: true },
  )
    .populate("designation")
    .populate("store")
    .select("-password");

  return updatedUser;
};

//**BULK IMPORT */
export const bulkImportUsers = async (fileBuffer) => {
  const records = [];

  // 1. Parse CSV File Buffer into JSON Records array
  const stream = Readable.from(fileBuffer);
  await new Promise((resolve, reject) => {
    stream
      .pipe(csvParser())
      .on("data", (row) => records.push(row))
      .on("end", resolve)
      .on("error", reject);
  });

  if (records.length === 0) {
    throw new ApiError(400, "The uploaded CSV file contains no data rows.");
  }

  // Pre-fetch models dynamically to keep references active
  const StoreModel = mongoose.model("Store");
  const DesignationModel = mongoose.model("Designation");

  // In-memory caches to save database calls for repeated locations/designations
  const storeCache = {};
  const designationCache = {};

  const defaultPassword = "Password@123";
  const hashedPassword = await bcrypt.hash(defaultPassword, 10);

  const parsedUsers = [];
  const skipLogs = [];

  // 2. Process each row line-by-line
  for (const [index, row] of records.entries()) {
    const rowNumber = index + 2; // Adding 2 because header is row 1 and index starts at 0

    const employeeId = (row["Employe Code"] || row["E code"] || "")
      .toString()
      .trim();
    const name = (row["Name"] || "").toString().trim();
    const locationStr = (row["Location"] || "").toString().trim();
    const designationStr = (row["Designation"] || "").toString().trim();

    // Skip row missing fundamental keys
    if (!employeeId || !name) {
      skipLogs.push({
        row: rowNumber,
        employeeId: employeeId || "N/A",
        reason: "Missing Employee Code or Name",
      });
      continue;
    }

    try {
      let storeId = null;
      let designationId = null;

      // --- RESOLVE STORE ---
      if (locationStr) {
        const storeKey = locationStr.toLowerCase();

        if (storeCache[storeKey]) {
          storeId = storeCache[storeKey];
        } else {
          // Check if it already exists in the database
          let store = await StoreModel.findOne({
            name: { $regex: new RegExp(`^${locationStr}$`, "i") },
          });

          if (!store) {
            // Generate standard uppercase code from location string to satisfy { unique: true } indexes
            const generatedCode = locationStr
              .toUpperCase()
              .replace(/\s+/g, "_");

            // Check if another store has this generated code to avoid E11000 crashes
            store = await StoreModel.findOne({ code: generatedCode });

            if (!store) {
              // Create it freshly
              store = await StoreModel.create({
                name: locationStr,
                code: generatedCode,
              });
            }
          }

          storeId = store._id;
          storeCache[storeKey] = storeId; // Save to runtime cache
        }
      }

      // --- RESOLVE DESIGNATION ---
      if (designationStr) {
        const designationKey = designationStr.toLowerCase();

        if (designationCache[designationKey]) {
          designationId = designationCache[designationKey];
        } else {
          // Check if it already exists in the database
          let designation = await DesignationModel.findOne({
            name: { $regex: new RegExp(`^${designationStr}$`, "i") },
          });

          if (!designation) {
            // Generate uppercase code for the new designation just in case it requires a code index
            const generatedCode = designationStr
              .toUpperCase()
              .replace(/\s+/g, "_");

            designation = await DesignationModel.findOne({
              code: generatedCode,
            });

            if (!designation) {
              designation = await DesignationModel.create({
                name: designationStr,
                code: generatedCode,
              });
            }
          }

          designationId = designation._id;
          designationCache[designationKey] = designationId; // Save to runtime cache
        }
      }

      // Generate mandatory unique fallback email
      const email = `${employeeId.toLowerCase()}@company.com`;

      parsedUsers.push({
        employeeId,
        name,
        email,
        password: hashedPassword,
        role: "Employee",
        designation: designationId,
        store: storeId,
        isActive: true,
      });
    } catch (rowError) {
      // If any dynamic creation or indexing crashes, safely capture the error and move to next record
      skipLogs.push({
        row: rowNumber,
        employeeId,
        reason: `Failed resolving dependencies: ${rowError.message}`,
      });
      continue;
    }
  }

  // 3. Bulk Write executing unordered insert strategy for the successfully mapped users
  let successfulInserts = 0;
  if (parsedUsers.length > 0) {
    try {
      const inserted = await User.insertMany(parsedUsers, { ordered: false });
      successfulInserts = inserted.length;
    } catch (error) {
      // Capture successful writes if user collection unique constraints are hit
      if (error.insertedDocs) {
        successfulInserts = error.insertedDocs.length;
      }
      if (error.writeErrors) {
        error.writeErrors.forEach((err) => {
          const failedUser = parsedUsers[err.index];
          skipLogs.push({
            row: `Database Index ${err.index}`,
            employeeId: failedUser ? failedUser.employeeId : "Unknown",
            reason:
              err.errmsg ||
              "User validation or duplicate key failure in database collection",
          });
        });
      }
    }
  }

  return {
    totalRecordsFound: records.length,
    successCount: successfulInserts,
    failedCount: skipLogs.length,
    skips: skipLogs,
  };
};
