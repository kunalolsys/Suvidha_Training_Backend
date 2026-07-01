import Progress from "../models/Progress.js";
import ApiError from "../utils/ApiError.js";

/**
 * Update video progress status (e.g., locked -> unlocked -> completed)
 */
export const updateVideoStatus = async (userId, videoId, status) => {
  let progress = await Progress.findOne({ employee: userId, video: videoId });

  if (!progress) {
    // If no progress document exists yet for this employee/video, create one
    progress = new Progress({
      employee: userId,
      video: videoId,
      status: status,
    });
  } else {
    progress.status = status;
  }

  if (status === "completed") {
    progress.completedAt = new Date();
  }

  await progress.save();
  return progress;
};

/**
 * Submit a quiz assessment attempt for a specific video training
 */
export const submitQuizAttempt = async (userId, videoId, attemptData) => {
  const { score, totalQuestions, answers, passed } = attemptData;

  let progress = await Progress.findOne({ employee: userId, video: videoId });

  if (!progress) {
    // Create baseline progress context if it doesn't exist
    progress = new Progress({
      employee: userId,
      video: videoId,
      status: "unlocked",
    });
  }

  // Increment total attempts
  progress.attempts += 1;

  // Append new attempt schema object to structural history tracking array
  progress.history.push({
    score,
    totalQuestions,
    answers,
    passed,
    attemptedAt: new Date(),
  });

  // If the user passes the quiz, automatically upgrade status to completed
  if (passed) {
    progress.status = "completed";
    progress.completedAt = new Date();
  }

  await progress.save();
  return progress;
};

/**
 * Get tracking progress details for an employee
 */
export const getEmployeeProgress = async (userId) => {
  const userProgress = await Progress.find({ employee: userId })
    .populate("video", "title veedUrl sortOrder duration") // Adjust fields based on Video schema
    .sort({ createdAt: -1 });

  return userProgress;
};
