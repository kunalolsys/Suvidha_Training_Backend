import asyncHandler from "../middleware/asyncHandler.js";
import ApiResponse from "../utils/ApiResponse.js";

import * as storeService from "../services/store.service.js";

export const createStore = asyncHandler(async (req, res) => {
  const store = await storeService.createStore(req.body);

  return res
    .status(201)
    .json(new ApiResponse(201, "Store created successfully", store));
});

export const getStores = asyncHandler(async (req, res) => {
  const data = await storeService.getStores(req.query);

  return res
    .status(200)
    .json(new ApiResponse(200, "Stores fetched successfully", data));
});
export const getAllStores = asyncHandler(async (req, res) => {
  const data = await storeService.getAllStores();

  return res
    .status(200)
    .json(new ApiResponse(200, "Stores fetched successfully", data));
});

export const getStoreById = asyncHandler(async (req, res) => {
  const store = await storeService.getStoreById(req.params.id);

  return res
    .status(200)
    .json(new ApiResponse(200, "Store fetched successfully", store));
});

export const updateStore = asyncHandler(async (req, res) => {
  const store = await storeService.updateStore(req.params.id, req.body);

  return res
    .status(200)
    .json(new ApiResponse(200, "Store updated successfully", store));
});

export const deleteStore = asyncHandler(async (req, res) => {
  await storeService.deleteStore(req.params.id);

  return res
    .status(200)
    .json(new ApiResponse(200, "Store deleted successfully"));
});
