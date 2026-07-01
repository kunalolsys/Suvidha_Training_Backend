import Designation from "../models/Designation.js";
import ApiError from "../utils/ApiError.js";

export const createDesignation = async (body) => {
  const { name, description } = body;

  const exists = await Designation.findOne({
    name: {
      $regex: `^${name.trim()}$`,
      $options: "i",
    },
  });

  if (exists) {
    throw new ApiError(409, "Designation already exists");
  }

  return await Designation.create({
    name: name.trim(),
    description,
  });
};

export const getDesignations = async ({
  page = 1,
  limit = 10,
  search = "",
}) => {
  const filter = {
    isActive: true,
  };

  if (search) {
    filter.name = {
      $regex: search,
      $options: "i",
    };
  }

  const skip = (page - 1) * limit;

  const [designations, total] = await Promise.all([
    Designation.find(filter).sort({ name: 1 }).skip(skip).limit(Number(limit)),
    Designation.countDocuments(filter),
  ]);

  return {
    designations,
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / limit),
  };
};

export const getDesignationById = async (id) => {
  const designation = await Designation.findById(id);

  if (!designation || !designation.isActive) {
    throw new ApiError(404, "Designation not found");
  }

  return designation;
};

export const updateDesignation = async (id, body) => {
  const designation = await Designation.findById(id);

  if (!designation || !designation.isActive) {
    throw new ApiError(404, "Designation not found");
  }

  if (body.name) {
    const duplicate = await Designation.findOne({
      _id: { $ne: id },
      name: {
        $regex: `^${body.name.trim()}$`,
        $options: "i",
      },
    });

    if (duplicate) {
      throw new ApiError(409, "Designation already exists");
    }

    designation.name = body.name.trim();
  }

  if (body.description !== undefined) {
    designation.description = body.description;
  }

  await designation.save();

  return designation;
};

export const deleteDesignation = async (id) => {
  const designation = await Designation.findById(id);

  if (!designation || !designation.isActive) {
    throw new ApiError(404, "Designation not found");
  }

  designation.isActive = false;

  await designation.save();

  return null;
};
