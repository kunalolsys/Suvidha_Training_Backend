import Question from "../models/Question.js";
import Video from "../models/Video.js";
import ApiError from "../utils/ApiError.js";

export const createVideo = async (body) => {
  const { title, veedUrl, designation, sortOrder, duration, thumbnail } = body;

  const exists = await Video.findOne({
    designation: { $in: designation },
    sortOrder,
    isActive: true,
  });

  if (exists) {
    throw new ApiError(409, "Sort order already exists for this designation");
  }

  return await Video.create({
    title,
    veedUrl,
    designation,
    sortOrder,
    duration,
    thumbnail,
  });
};

export const getVideos = async ({
  page = 1,
  limit = 10,
  search = "",
  designation,
}) => {
  const filter = {
    isActive: true,
  };
  if (designation) {
    filter.designation = Array.isArray(designation)
      ? { $in: designation }
      : designation;
  }

  if (search) {
    filter.title = {
      $regex: search,
      $options: "i",
    };
  }

  const skip = (page - 1) * limit;

  const [videos, total] = await Promise.all([
    Video.find(filter)
      .populate("designation")
      .sort({ sortOrder: 1 })
      .skip(skip)
      .limit(Number(limit)),

    Video.countDocuments(filter),
  ]);

  return {
    videos,
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / limit),
    },
  };
};
export const getVideosForEmployee = async ({ designation }) => {
  const filter = {
    isActive: true,
  };

  if (designation) {
    filter.designation = Array.isArray(designation)
      ? { $in: designation }
      : designation;
  }

  const [videos, total] = await Promise.all([
    Video.find(filter).populate("designation").sort({ sortOrder: 1 }),

    Video.countDocuments(filter),
  ]);

  return {
    videos,
  };
};
export const getAllVideos = async () => {
  const filter = {
    isActive: true,
  };

  const [videos, total] = await Promise.all([
    Video.find(filter).populate("designation").sort({ sortOrder: 1 }),

    Video.countDocuments(filter),
  ]);

  return {
    videos,
  };
};
export const getVideoById = async (id) => {
  const video = await Video.findById(id).populate("designation");

  if (!video || !video.isActive) {
    throw new ApiError(404, "Video not found");
  }
  return {
    video,
  };
};

export const updateVideo = async (id, body) => {
  const video = await Video.findById(id);

  if (!video || !video.isActive) {
    throw new ApiError(404, "Video not found");
  }

  if (body.sortOrder || body.designation) {
    const targetSortOrder =
      body.sortOrder !== undefined ? body.sortOrder : video.sortOrder;
    const targetDesignation = body.designation || video.designation;

    const exists = await Video.findOne({
      _id: { $ne: id },
      designation: { $in: targetDesignation },
      sortOrder: targetSortOrder,
      isActive: true,
    });

    if (exists) {
      throw new ApiError(
        409,
        "Sort order already exists in one of the selected designations",
      );
    }
  }

  Object.assign(video, body);

  await video.save();

  return video.populate("designation");
};
export const deleteVideo = async (id) => {
  const video = await Video.findById(id);

  if (!video || !video.isActive) {
    throw new ApiError(404, "Video not found");
  }

  const questionExists = await Question.exists({ video: id });

  if (questionExists) {
    throw new ApiError(
      409,
      "Cannot delete video. One or more questions are linked to this video.",
    );
  }

  video.isActive = false;

  await video.save();

  return {
    message: "Video deleted successfully",
  };
};
