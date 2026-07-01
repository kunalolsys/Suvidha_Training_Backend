import * as progressService from "../services/progress.service.js";
import asyncHandler from "../middleware/asyncHandler.js";
import ApiResponse from "../utils/ApiResponse.js";
import ApiError from "../utils/ApiError.js";

// 1. Update Video Watching Status
export const updateVideoStatus = asyncHandler(async (req, res) => {
  const { videoId, status } = req.body;
  const userId = req.user._id; // Populated from your auth/protect middleware

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
  const { videoId, score, totalQuestions, answers, passed } = req.body;
  const userId = req.user._id;

  if (!videoId || score === undefined || !totalQuestions || !answers) {
    throw new ApiError(
      400,
      "Missing required fields for submitting quiz attempt",
    );
  }

  const updatedProgress = await progressService.submitQuizAttempt(
    userId,
    videoId,
    {
      score,
      totalQuestions,
      answers,
      passed,
    },
  );

  return res
    .status(201)
    .json(
      new ApiResponse(
        201,
        "Quiz attempt processed successfully",
        updatedProgress,
      ),
    );
});

// 3. Fetch current logged-in user's training progress dashboard map
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
