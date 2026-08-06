// controllers/progress.controller.js
import * as progressService from "../services/progress.service.js";
import asyncHandler from "../middleware/asyncHandler.js";
import ApiResponse from "../utils/ApiResponse.js";
import ApiError from "../utils/ApiError.js";

// 1. Update Video Watching Status
export const updateVideoStatus = asyncHandler(async (req, res) => {
  const { videoId, status } = req.body;
  const userId = req.user._id;

  if (!videoId || !status) {
    throw new ApiError(400, "Video ID and status are required fields");
  }

  const updatedProgress = await progressService.updateVideoStatus(
    userId,
    videoId,
    status,
  );

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        `Video status successfully updated to ${status}`,
        updatedProgress,
      ),
    );
});

// 2. Submit Quiz Assessment Attempt
export const submitQuizAttempt = asyncHandler(async (req, res) => {
  const { videoId, answers } = req.body;
  const userId = req.user._id;

  if (!videoId || !Array.isArray(answers)) {
    throw new ApiError(
      400,
      "Video ID and answers array are required to submit quiz attempt",
    );
  }

  const result = await progressService.submitQuizAttempt(
    userId,
    videoId,
    answers,
  );

  return res
    .status(201)
    .json(
      new ApiResponse(
        201,
        result.latestAttempt.passed
          ? "Quiz passed successfully!"
          : "Quiz attempt recorded. You did not reach the pass score.",
        result,
      ),
    );
});

// 3. Fetch Logged-in User's Progress Tracking
export const getMyProgress = asyncHandler(async (req, res) => {
  const data = await progressService.getEmployeeProgress(req.user._id);

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        "Employee training progress tracking pulled successfully",
        data,
      ),
    );
});
export const getEmpProgress = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const data = await progressService.getEmployeeProgressForAdminSide(id);

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        "Employee training progress tracking pulled successfully",
        data,
      ),
    );
});

// 4. Fetch Official Certification Audit Record
export const getMyCertificateData = asyncHandler(async (req, res) => {
  const certData = await progressService.getCertificateData(req.user._id);

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        "Certificate verification payload generated successfully",
        certData,
      ),
    );
});
