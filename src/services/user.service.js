import User from "../models/User.js";
import ApiError from "../utils/ApiError.js";

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
