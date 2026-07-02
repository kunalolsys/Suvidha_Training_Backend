import ApiResponse from "../utils/ApiResponse.js";
import * as userService from "../services/user.service.js";
import asyncHandler from "../middleware/asyncHandler.js";

export const getUsers = asyncHandler(async (req, res) => {
  const data = await userService.getUsers(req.query);

  return res
    .status(200)
    .json(new ApiResponse(200, "Users fetched successfully", data));
});

export const updateUser = asyncHandler(async (req, res) => {
  const data = await userService.updateUser(req.params.id, req.body);

  return res
    .status(200)
    .json(new ApiResponse(200, "User updated successfully", data));
});
