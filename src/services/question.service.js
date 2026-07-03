import Question from "../models/Question.js";
import Video from "../models/Video.js";
import ApiError from "../utils/ApiError.js";

export const createQuestion = async (body) => {
  const { video, question, options, sortOrder } = body;

  const videoExists = await Video.findById(video);

  if (!videoExists) {
    throw new ApiError(404, "Video not found");
  }

  const duplicateOrder = await Question.findOne({
    video,
    sortOrder,
  });

  if (duplicateOrder) {
    throw new ApiError(409, "Sort order already exists for this video");
  }

  const correctAnswers = options.filter((option) => option.isCorrect);

  if (correctAnswers.length !== 1) {
    throw new ApiError(400, "Exactly one correct option is required");
  }

  return await Question.create({
    video,
    question,
    options,
    sortOrder,
  });
};

export const getQuestions = async ({
  page = 1,
  limit = 10,
  search = "",
  video,
}) => {
  const filter = {};

  if (video) {
    filter.video = video;
  }

  if (search) {
    filter.question = {
      $regex: search,
      $options: "i",
    };
  }

  const skip = (page - 1) * Number(limit);

  const [questions, total] = await Promise.all([
    Question.find(filter)
      .populate("video")
      .sort({ sortOrder: 1 })
      .skip(skip)
      .limit(Number(limit)),

    Question.countDocuments(filter),
  ]);

  return {
    questions,
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / limit),
    },
  };
};

export const getQuestionById = async (id) => {
  const question = await Question.findById(id).populate("video");

  if (!question) {
    throw new ApiError(404, "Question not found");
  }

  return question;
};

export const updateQuestion = async (id, body) => {
  const question = await Question.findById(id);

  if (!question) {
    throw new ApiError(404, "Question not found");
  }

  if (body.options) {
    const correctAnswers = body.options.filter((option) => option.isCorrect);

    if (correctAnswers.length !== 1) {
      throw new ApiError(400, "Exactly one correct option is required");
    }
  }

  if (body.sortOrder && body.sortOrder !== question.sortOrder) {
    const exists = await Question.findOne({
      _id: { $ne: id },
      video: body.video || question.video,
      sortOrder: body.sortOrder,
    });

    if (exists) {
      throw new ApiError(409, "Sort order already exists");
    }
  }

  Object.assign(question, body);

  await question.save();

  return question.populate("video");
};

export const deleteQuestion = async (id) => {
  const question = await Question.findByIdAndDelete(id);

  if (!question) {
    throw new ApiError(404, "Question not found");
  }

  return {
    message: "Question deleted successfully",
  };
};
export const getQuestionsPerVideo = async (videoId) => {
  const filter = {};

  if (videoId) {
    filter.video = videoId;
  }

  const [questions, total] = await Promise.all([
    Question.find(filter).populate("video").sort({ sortOrder: 1 }),
    Question.countDocuments(filter),
  ]);

  return {
    questions,
  };
};
