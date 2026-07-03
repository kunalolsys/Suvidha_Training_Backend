import asyncHandler from "../middleware/asyncHandler.js";
import ApiResponse from "../utils/ApiResponse.js";
import * as questionService from "../services/question.service.js";

export const createQuestion = asyncHandler(async (req, res) => {
  const question = await questionService.createQuestion(req.body);

  return res
    .status(201)
    .json(new ApiResponse(201, "Question created successfully", question));
});

export const getQuestions = asyncHandler(async (req, res) => {
  const questions = await questionService.getQuestions(req.query);

  return res
    .status(200)
    .json(new ApiResponse(200, "Questions fetched successfully", questions));
});
export const getQuestionsPerVideo = asyncHandler(async (req, res) => {
  const questions = await questionService.getQuestionsPerVideo(req.params.videoId);

  return res
    .status(200)
    .json(new ApiResponse(200, "Questions fetched successfully", questions));
});

export const getQuestionById = asyncHandler(async (req, res) => {
  const question = await questionService.getQuestionById(req.params.id);

  return res
    .status(200)
    .json(new ApiResponse(200, "Question fetched successfully", question));
});

export const updateQuestion = asyncHandler(async (req, res) => {
  const question = await questionService.updateQuestion(
    req.params.id,
    req.body,
  );

  return res
    .status(200)
    .json(new ApiResponse(200, "Question updated successfully", question));
});

export const deleteQuestion = asyncHandler(async (req, res) => {
  await questionService.deleteQuestion(req.params.id);

  return res
    .status(200)
    .json(new ApiResponse(200, "Question deleted successfully"));
});
