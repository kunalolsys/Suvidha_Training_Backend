import * as authService from "../services/auth.service.js";
import asyncHandler from "../middleware/asyncHandler.js";
import ApiResponse from "../utils/ApiResponse.js";

export const register = asyncHandler(async (req, res) => {
  const data = await authService.register(req.body);

  return res
    .status(201)
    .json(new ApiResponse(201, "User registered successfully", data));
});

export const login = asyncHandler(async (req, res) => {
  const data = await authService.login(req.body);

  return res.status(200).json(new ApiResponse(200, "Login successful", data));
});

export const profile = asyncHandler(async (req, res) => {
  const data = await authService.profile(req.user._id);

  return res
    .status(200)
    .json(new ApiResponse(200, "Profile fetched successfully", data));
});

export const changePassword = asyncHandler(async (req, res) => {
  const { oldPassword, newPassword } = req.body;

  await authService.changePassword(req.user._id, oldPassword, newPassword);

  return res
    .status(200)
    .json(new ApiResponse(200, "Password changed successfully"));
});
export const updateProfile = asyncHandler(async (req, res) => {
  const userId = req.user?._id || req.cookies?.userId;

  if (!userId) {
    throw new ApiError(401, "Unauthorized access: User session missing");
  }

  const { name, email, avatar } = req.body;

  // Call the updateProfile service function
  const updatedUser = await authService.updateProfile(userId, {
    name,
    email,
    avatar,
  });

  return res
    .status(200)
    .json(new ApiResponse(200, updatedUser, "Profile updated successfully"));
});
//**BULK IMPORT USER */
export const bulkImportUsers = asyncHandler(async (req, res) => {
  if (!req.file) {
    throw new ApiError(400, "Please upload a valid CSV file");
  }

  // Pass the file buffer directly from memory to the service layer
  const data = await authService.bulkImportUsers(req.file.buffer);

  return res
    .status(200)
    .json(new ApiResponse(200, "Bulk import completed successfully", data));
});
