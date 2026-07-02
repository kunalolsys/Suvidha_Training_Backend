import Store from "../models/Store.js";
import ApiError from "../utils/ApiError.js";

export const createStore = async (body) => {
  const { name, code, address } = body;

  const exists = await Store.findOne({
    $or: [{ name: name.trim() }, { code: code.trim().toUpperCase() }],
  });

  if (exists) {
    throw new ApiError(409, "Store already exists");
  }

  const store = await Store.create({
    name: name.trim(),
    code: code.trim().toUpperCase(),
    address,
  });

  return store;
};

export const getStores = async ({ page = 1, limit = 10, search = "" }) => {
  const filter = {};

  if (search) {
    filter.$or = [
      {
        name: {
          $regex: search,
          $options: "i",
        },
      },
      {
        code: {
          $regex: search,
          $options: "i",
        },
      },
    ];
  }

  const skip = (page - 1) * limit;

  const [stores, total] = await Promise.all([
    Store.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
    Store.countDocuments(filter),
  ]);

  return {
    stores,
    total,
    page: Number(page),
    limit: Number(limit),
    totalPages: Math.ceil(total / limit),
  };
};
export const getAllStores = async () => {
  const [stores, total] = await Promise.all([
    Store.find().sort({ createdAt: -1 }),
    Store.countDocuments(),
  ]);

  return {
    stores,
    total,
  };
};
export const getStoreById = async (id) => {
  const store = await Store.findById(id);

  if (!store) {
    throw new ApiError(404, "Store not found");
  }

  return store;
};

export const updateStore = async (id, body) => {
  const store = await Store.findById(id);

  if (!store) {
    throw new ApiError(404, "Store not found");
  }

  if (body.name) store.name = body.name.trim();

  if (body.code) store.code = body.code.trim().toUpperCase();

  if (body.address !== undefined) store.address = body.address;

  await store.save();

  return store;
};

export const deleteStore = async (id) => {
  const store = await Store.findById(id);

  if (!store) {
    throw new ApiError(404, "Store not found");
  }

  await store.deleteOne();

  return null;
};
