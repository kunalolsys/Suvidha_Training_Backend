import Counter from "../models/Counter.js";
import Question from "../models/Question.js";
import Video from "../models/Video.js";
import ApiError from "../utils/ApiError.js";
import XLSX from "xlsx";

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

export const importQuestions = async (videoId, filePath) => {
  const video = await Video.findById(videoId);

  if (!video) {
    throw new ApiError(404, "Video not found");
  }

  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet);

  const questions = [];
  const errors = [];

  // Existing sort orders in DB
  const existingQuestions = await Question.find(
    { video: videoId },
    "sortOrder",
  );

  const usedSortOrders = new Set(existingQuestions.map((q) => q.sortOrder));
  const excelSortOrders = new Set();

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const rowNumber = index + 2;

    try {
      const question = row["Question"]?.toString().trim();
      const optionA = row["Option A"]?.toString().trim();
      const optionB = row["Option B"]?.toString().trim();
      const optionC = row["Option C"]?.toString().trim();
      const optionD = row["Option D"]?.toString().trim();
      const correct = row["Correct Option"]?.toString().trim().toUpperCase();
      const sortOrder = Number(row["Sort Order"]);

      if (!question) throw new Error("Question is required");
      if (!optionA || !optionB || !optionC || !optionD)
        throw new Error("All four options are required");
      if (!["A", "B", "C", "D"].includes(correct))
        throw new Error("Correct Option must be A, B, C or D");
      if (!Number.isInteger(sortOrder) || sortOrder <= 0)
        throw new Error("Invalid Sort Order");
      if (usedSortOrders.has(sortOrder))
        throw new Error(`Sort Order ${sortOrder} already exists`);
      if (excelSortOrders.has(sortOrder))
        throw new Error(`Duplicate Sort Order ${sortOrder} in Excel`);

      excelSortOrders.add(sortOrder);

      questions.push({
        video: videoId,
        question,
        sortOrder,
        options: [
          { option: optionA, isCorrect: correct === "A" },
          { option: optionB, isCorrect: correct === "B" },
          { option: optionC, isCorrect: correct === "C" },
          { option: optionD, isCorrect: correct === "D" },
        ],
      });
    } catch (err) {
      errors.push({
        row: rowNumber,
        reason: err.message,
      });
    }
  }

  // --- FIX APPLIED HERE ---
  if (questions.length) {
    // 1. Atomically reserve a block of IDs for this bulk operation
    const counter = await Counter.findOneAndUpdate(
      { _id: "question" },
      { $inc: { seq: questions.length } }, // Increment by total number of records
      { upsert: true, returnDocument: "after" },
    );

    // 2. Calculate the starting sequence number for this batch
    let startSeq = counter.seq - questions.length + 1;

    // 3. Assign custom IDs manually before running insertMany
    questions.forEach((q) => {
      q.questionId = `QUE-${String(startSeq).padStart(3, "0")}`;
      startSeq++;
    });

    // 4. Safely batch insert them
    await Question.insertMany(questions);
  }

  return {
    imported: questions.length,
    skipped: errors.length,
    errors,
  };
};
