import asyncHandler from "../middleware/asyncHandler.js";
import ApiResponse from "../utils/ApiResponse.js";
import * as designationService from "../services/designation.service.js";

export const createDesignation = asyncHandler(async (req, res) => {
  const designation = await designationService.createDesignation(req.body);

  return res
    .status(201)
    .json(
      new ApiResponse(201, "Designation created successfully", designation),
    );
});

export const getDesignations = asyncHandler(async (req, res) => {
  const data = await designationService.getDesignations(req.query);

  return res
    .status(200)
    .json(new ApiResponse(200, "Designations fetched successfully", data));
});

export const getDesignationById = asyncHandler(async (req, res) => {
  const designation = await designationService.getDesignationById(
    req.params.id,
  );

  return res
    .status(200)
    .json(
      new ApiResponse(200, "Designation fetched successfully", designation),
    );
});

export const updateDesignation = asyncHandler(async (req, res) => {
  const designation = await designationService.updateDesignation(
    req.params.id,
    req.body,
  );

  return res
    .status(200)
    .json(
      new ApiResponse(200, "Designation updated successfully", designation),
    );
});

export const deleteDesignation = asyncHandler(async (req, res) => {
  await designationService.deleteDesignation(req.params.id);

  return res
    .status(200)
    .json(new ApiResponse(200, "Designation deleted successfully"));
});
