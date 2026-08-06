import User from "../models/User.js";
import ApiError from "../utils/ApiError.js";
import axios from "axios";
import Designation from "../models/Designation.js";
import Store from "../models/Store.js";
import bcrypt from "bcryptjs";
export const getUsers = async ({
  page = 1,
  limit = 10,
  search = "",
  role,
  designation,
  store,
  isActive,
}) => {
  const filter = {
    role: { $ne: "Admin" },
  };
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
      { employeeId: { $regex: search, $options: "i" } },
    ];
  }

  if (role) {
    filter.role = role;
  }

  if (designation) {
    filter.designation = designation;
  }

  if (store) {
    filter.store = store;
  }

  if (typeof isActive === "boolean") {
    filter.isActive = isActive;
  }

  const skip = (Number(page) - 1) * Number(limit);

  const [users, total] = await Promise.all([
    User.find(filter)
      .populate("designation", "name")
      .populate("store", "name")
      .select("-password")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit)),
    User.countDocuments(filter),
  ]);

  return {
    users,
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / limit),
    },
  };
};

export const updateUser = async (id, payload) => {
  const user = await User.findById(id);

  if (!user) {
    throw new ApiError(404, "User not found");
  }

  const {
    name,
    email,
    employeeId,
    designation,
    store,
    role,
    avatar,
    isActive,
  } = payload;

  if (email && email !== user.email) {
    const exists = await User.findOne({
      email: email.toLowerCase(),
      _id: { $ne: id },
    });

    if (exists) {
      throw new ApiError(400, "Email already exists");
    }

    user.email = email.toLowerCase();
  }

  if (employeeId && employeeId !== user.employeeId) {
    const exists = await User.findOne({
      employeeId,
      _id: { $ne: id },
    });

    if (exists) {
      throw new ApiError(400, "Employee ID already exists");
    }

    user.employeeId = employeeId;
  }

  if (name !== undefined) user.name = name;
  if (designation !== undefined) user.designation = designation;
  if (store !== undefined) user.store = store;
  if (role !== undefined) user.role = role;
  if (avatar !== undefined) user.avatar = avatar;
  if (isActive !== undefined) user.isActive = isActive;

  await user.save();

  return await User.findById(id)
    .populate("designation", "name")
    .populate("store", "name")
    .select("-password");
};

//**SYNC USERS */
export const syncStuEmployees = async (req, res) => {
  try {
    // 1. Fetch remote data
    const { data: stuEmployees } = await axios.post(
      "https://mis.suvidhastores.com/api/load-ften-data",
      {},
      { timeout: 60000 },
    );

    if (!Array.isArray(stuEmployees) || stuEmployees.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No employee data received from STU API.",
      });
    }

    let created = 0;
    let updated = 0;
    let skipped = 0;
    let activated = 0;
    let deactivated = 0;

    // 2. Collect unique sets for Designations, Stores, and Codes
    const stuEmployeeIdsSet = new Set();
    const uniqueDesignationNames = new Set();
    const uniqueStoreNames = new Set();

    for (const emp of stuEmployees) {
      if (!emp.employee_code) continue;
      const code = String(emp.employee_code).trim();
      stuEmployeeIdsSet.add(code);

      const dName = (emp.designation || "").trim();
      const sName = (emp.location || "").trim();

      if (dName) uniqueDesignationNames.add(dName);
      if (sName) uniqueStoreNames.add(sName);
    }

    // 3. Fetch Designations & Stores into Memory
    const [existingDesignations, existingStores, existingUsers] =
      await Promise.all([
        Designation.find().lean(),
        Store.find().lean(),
        User.find(
          {},
          {
            _id: 1,
            employeeId: 1,
            name: 1,
            email: 1,
            role: 1,
            designation: 1,
            store: 1,
            isActive: 1,
          },
        ).lean(),
      ]);

    const designationMap = new Map(
      existingDesignations.map((d) => [d.name.trim().toLowerCase(), d]),
    );
    const storeMap = new Map(
      existingStores.map((s) => [s.name.trim().toLowerCase(), s]),
    );

    // 4. Batch Create Missing Designations
    const newDesignationsToCreate = [];
    for (const dName of uniqueDesignationNames) {
      if (!designationMap.has(dName.toLowerCase())) {
        newDesignationsToCreate.push({ name: dName });
      }
    }
    if (newDesignationsToCreate.length > 0) {
      const createdDesignations = await Designation.insertMany(
        newDesignationsToCreate,
      );
      for (const d of createdDesignations) {
        designationMap.set(d.name.trim().toLowerCase(), d);
      }
    }

    // 5. Batch Create Missing Stores
    const newStoresToCreate = [];
    for (const sName of uniqueStoreNames) {
      if (!storeMap.has(sName.toLowerCase())) {
        newStoresToCreate.push({ name: sName });
      }
    }
    if (newStoresToCreate.length > 0) {
      const createdStores = await Store.insertMany(newStoresToCreate);
      for (const s of createdStores) {
        storeMap.set(s.name.trim().toLowerCase(), s);
      }
    }

    // Index existing users
    const userMap = new Map(existingUsers.map((u) => [u.employeeId, u]));

    // 6. Pre-identify New Users & Hash Passwords Concurrently in Batches
    const newUsersList = [];
    const updateOperations = [];

    for (const emp of stuEmployees) {
      if (!emp.employee_code) {
        skipped++;
        continue;
      }

      const employeeId = String(emp.employee_code).trim();
      const designationName = (emp.designation || "").trim();
      const storeName = (emp.location || "").trim();

      const designation = designationMap.get(designationName.toLowerCase());
      const store = storeMap.get(storeName.toLowerCase());
      const existingUser = userMap.get(employeeId);

      // Skip Admins
      if (existingUser && existingUser.role === "Admin") {
        skipped++;
        continue;
      }

      // Skip missing designation
      if (!designation) {
        skipped++;
        continue;
      }

      // NEW USER
      if (!existingUser) {
        newUsersList.push({
          employeeId,
          name: emp.name,
          role: emp.Role || "Employee",
          designation: designation._id,
          store: store ? store._id : undefined,
          isActive: true,
        });
        created++;
        continue;
      }

      // EXISTING USER UPDATES
      const updateData = {};

      if (existingUser.name !== emp.name) {
        updateData.name = emp.name;
      }

      if (
        emp.email &&
        emp.email !== "NULL" &&
        existingUser.email !== emp.email.toLowerCase()
      ) {
        updateData.email = emp.email.toLowerCase();
      }

      if (existingUser.role !== (emp.Role || "Employee")) {
        updateData.role = emp.Role || "Employee";
      }

      if (
        designation &&
        String(existingUser.designation) !== String(designation._id)
      ) {
        updateData.designation = designation._id;
      }

      if (store && String(existingUser.store) !== String(store._id)) {
        updateData.store = store._id;
      }

      if (!existingUser.isActive) {
        updateData.isActive = true;
        activated++;
      }

      if (Object.keys(updateData).length > 0) {
        updateOperations.push({
          updateOne: {
            filter: { _id: existingUser._id },
            update: { $set: updateData },
          },
        });
        updated++;
      } else {
        skipped++;
      }
    }

    // 7. Parallel Bcrypt Hashing for New Users (10x Faster)
    const BATCH_SIZE = 50;
    const insertOperations = [];

    for (let i = 0; i < newUsersList.length; i += BATCH_SIZE) {
      const batch = newUsersList.slice(i, i + BATCH_SIZE);
      const hashedBatch = await Promise.all(
        batch.map(async (u) => {
          const hashedPassword = await bcrypt.hash(u.employeeId, 10);
          return {
            insertOne: {
              document: {
                ...u,
                password: hashedPassword,
              },
            },
          };
        }),
      );
      insertOperations.push(...hashedBatch);
    }

    // 8. Bulk Execution
    const allBulkOps = [...insertOperations, ...updateOperations];
    if (allBulkOps.length > 0) {
      await User.bulkWrite(allBulkOps, { ordered: false });
    }

    // 9. Deactivate Missing Users
    const stuEmployeeIdsArray = Array.from(stuEmployeeIdsSet);
    const deactivationResult = await User.updateMany(
      {
        employeeId: { $nin: stuEmployeeIdsArray },
        isActive: true,
        role: { $ne: "Admin" },
      },
      {
        $set: { isActive: false },
      },
    );

    deactivated = deactivationResult.modifiedCount || 0;

    return res.status(200).json({
      success: true,
      message: "Employee sync completed successfully.",
      created,
      updated,
      skipped,
      activated,
      deactivated,
      totalFromSTU: stuEmployees.length,
    });
  } catch (error) {
    console.error("STU Sync Error:", error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
