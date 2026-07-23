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
    const { data: stuEmployees } = await axios.post(
      "https://mis.suvidhastores.com/api/load-ften-data",
    );
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let activated = 0;
    let deactivated = 0;

    // Store all employee codes from STU
    const stuEmployeeIds = new Set(
      stuEmployees.map((emp) => String(emp.employee_code).trim()),
    );

    for (const emp of stuEmployees) {
      const employeeId = String(emp.employee_code).trim();

      // const designation = await Designation.findOne({
      //   name: emp.designation,
      // });

      // const store = await Store.findOne({
      //   name: emp.location,
      // });

      const designations = await Designation.find();
      const stores = await Store.find();

      const designationMap = new Map(
        designations.map((d) => [d.name.trim().toLowerCase(), d]),
      );

      const storeMap = new Map(
        stores.map((s) => [s.name.trim().toLowerCase(), s]),
      );
      const designationName = (emp.designation || "").trim();
      const storeName = (emp.location || "").trim();

      // DESIGNATION
      let designation = designationMap.get(designationName.toLowerCase());

      if (!designation && designationName) {
        designation = await Designation.findOne({
          name: designationName,
        });

        if (!designation) {
          designation = await Designation.create({
            name: designationName,
          });
        }

        designationMap.set(designationName.toLowerCase(), designation);
      }

      // STORE
      let store = storeMap.get(storeName.toLowerCase());

      if (!store && storeName) {
        store = await Store.findOne({
          name: storeName,
        });

        if (!store) {
          store = await Store.create({
            name: storeName,
          });
        }

        storeMap.set(storeName.toLowerCase(), store);
      }

      // const existingUser = await User.findOne({ employeeId });
      const users = await User.find();

      const userMap = new Map(users.map((u) => [u.employeeId, u]));
      const existingUser = userMap.get(employeeId);

      if (existingUser && existingUser.role === "Admin") {
        skipped++;
        continue;
      }
      if (!designation) {
        skipped++;
        console.log(
          `Skipping Employee ${employeeId} (${emp.name}) - Designation missing`,
        );
        continue;
      }

      // CREATE NEW USER
      if (!existingUser) {
        const password = await bcrypt.hash(employeeId, 10);

        await User.create({
          employeeId,
          name: emp.name,
          // email:
          //   emp.email && emp.email !== "NULL"
          //     ? emp.email.toLowerCase()
          //     : `${employeeId}@stu.com`,
          password,
          role: emp.Role || "Employee",
          designation: designation?._id,
          store: store?._id,
          isActive: true,
        });

        created++;
        continue;
      }

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

      // Activate if currently inactive
      if (!existingUser.isActive) {
        updateData.isActive = true;
        activated++;
      }

      if (Object.keys(updateData).length > 0) {
        await User.findByIdAndUpdate(existingUser._id, updateData);
        updated++;
      } else {
        skipped++;
      }
    }

    // Deactivate users not present in STU sheet
    const usersToDeactivate = await User.find({
      employeeId: { $nin: [...stuEmployeeIds] },
      isActive: true,
      role: { $ne: "Admin" },
    });

    if (usersToDeactivate.length > 0) {
      await User.updateMany(
        {
          employeeId: { $nin: [...stuEmployeeIds] },
          isActive: true,
          role: { $ne: "Admin" },
        },
        {
          $set: { isActive: false },
        },
      );

      deactivated = usersToDeactivate.length;
    }

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
    console.error(error);

    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
