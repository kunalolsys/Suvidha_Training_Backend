import asyncHandler from "../middleware/asyncHandler.js";
import ApiResponse from "../utils/ApiResponse.js";
import * as videoService from "../services/video.service.js";

export const createVideo = asyncHandler(async (req, res) => {
  const video = await videoService.createVideo(req.body);

  return res
    .status(201)
    .json(new ApiResponse(201, "Video created successfully", video));
});

export const getVideos = asyncHandler(async (req, res) => {
  const videos = await videoService.getVideos(req.query);

  return res
    .status(200)
    .json(new ApiResponse(200, "Videos fetched successfully", videos));
});

export const getVideoById = asyncHandler(async (req, res) => {
  const video = await videoService.getVideoById(req.params.id);

  return res
    .status(200)
    .json(new ApiResponse(200, "Video fetched successfully", video));
});

export const updateVideo = asyncHandler(async (req, res) => {
  const video = await videoService.updateVideo(req.params.id, req.body);

  return res
    .status(200)
    .json(new ApiResponse(200, "Video updated successfully", video));
});

export const deleteVideo = asyncHandler(async (req, res) => {
  await videoService.deleteVideo(req.params.id);

  return res
    .status(200)
    .json(new ApiResponse(200, "Video deleted successfully"));
});
