// services/progress.service.js
import Progress from "../models/Progress.js";
import Video from "../models/Video.js";
import Question from "../models/Question.js";
import User from "../models/User.js";
import ApiError from "../utils/ApiError.js";

/**
 * Update video status (e.g., locked -> unlocked -> completed)
 */
export const updateVideoStatus = async (userId, videoId, status) => {
  const video = await Video.findById(videoId).populate("designation", "name");
  if (!video) {
    throw new ApiError(404, "Video module not found");
  }

  // Fetch employee to capture current designation at time of status update
  const employee = await User.findById(userId).populate("designation", "name");

  let progress = await Progress.findOne({ employee: userId, video: videoId });

  if (!progress) {
    progress = new Progress({
      employee: userId,
      video: videoId,
      designation: employee?.designation?._id || user?.designation,
      status: status,
    });
  } else {
    // Prevent regressing status if video is already completed
    if (progress.status !== "completed") {
      progress.status = status;
    }
    // Update active designation reference if not already saved
    if (!progress.designation && employee?.designation) {
      progress.designation = employee.designation._id;
    }
  }

  if (status === "completed" && !progress.completedAt) {
    progress.completedAt = new Date();
    // Freeze video metadata snapshot + designation at the time of completion
    progress.videoSnapshot = {
      title: video.title,
      sortOrder: video.sortOrder,
      duration: video.duration,
      designationName:
        employee?.designation?.name || video.designation?.name || "",
    };
  }

  await progress.save();
  return progress;
};

/**
 * Submit Quiz Attempt with Automated Grading & Immutable Audit Snapshotting
 *
 * @param {string} userId - ID of the employee
 * @param {string} videoId - ID of the video being tested
 * @param {Array<{ questionId: string, selectedOption: number }>} userAnswers - Client submitted answers
 */
export const submitQuizAttempt = async (userId, videoId, userAnswers) => {
  const video = await Video.findById(videoId).populate("designation", "name");
  if (!video) {
    throw new ApiError(404, "Target video training not found");
  }

  // Fetch employee to attach designation context
  const employee = await User.findById(userId).populate("designation", "name");

  // Fetch current active questions for this video
  const liveQuestions = await Question.find({ video: videoId }).sort({
    sortOrder: 1,
  });

  if (!liveQuestions || liveQuestions.length === 0) {
    throw new ApiError(
      400,
      "No assessment questions configured for this video",
    );
  }

  let correctCount = 0;
  const snapshot = [];

  // Build the immutable snapshot per question
  for (const q of liveQuestions) {
    const userAnswer = userAnswers.find(
      (a) => a.questionId === q._id.toString() || a.questionId === q.questionId,
    );

    const selectedIdx = userAnswer ? Number(userAnswer.selectedOption) : -1;

    // Determine correctness based on option's isCorrect flag
    let isCorrect = false;
    if (selectedIdx >= 0 && selectedIdx < q.options.length) {
      isCorrect = q.options[selectedIdx].isCorrect === true;
    }

    if (isCorrect) correctCount++;

    // Preserve exact question & options text at this moment in time
    snapshot.push({
      questionId: q.questionId || q._id.toString(),
      questionText: q.question,
      options: q.options.map((opt) => ({
        optionText: opt.option,
        isCorrect: opt.isCorrect,
      })),
      selectedOptionIndex: selectedIdx,
      isCorrect: isCorrect,
    });
  }

  const totalQuestions = liveQuestions.length;
  const score = Math.round((correctCount / totalQuestions) * 100);
  const PASS_THRESHOLD = 70; // Pass mark percentage
  const passed = score >= PASS_THRESHOLD;

  // Retrieve or initialize user progress
  let progress = await Progress.findOne({ employee: userId, video: videoId });

  if (!progress) {
    progress = new Progress({
      employee: userId,
      video: videoId,
      designation: employee?.designation?._id,
      status: "unlocked",
    });
  } else if (!progress.designation && employee?.designation) {
    progress.designation = employee.designation._id;
  }

  progress.attempts += 1;

  // Append new attempt into history array
  progress.history.push({
    score,
    totalQuestions,
    passed,
    attemptedAt: new Date(),
    snapshot,
  });

  // Mark module completed if test is passed
  if (passed && progress.status !== "completed") {
    progress.status = "completed";
    progress.completedAt = new Date();
    progress.videoSnapshot = {
      title: video.title,
      sortOrder: video.sortOrder,
      duration: video.duration,
      designationName:
        employee?.designation?.name || video.designation?.name || "",
    };
  }

  await progress.save();
  return {
    progress,
    latestAttempt: {
      score,
      totalQuestions,
      passed,
      correctCount,
    },
  };
};

/**
 * Fetch employee progress tracking data for Dashboard & Certificates
 */
export const getEmployeeProgress = async (userId) => {
  const userProgress = await Progress.find({ employee: userId })
    .populate({
      path: "video",
      select: "title veedUrl sortOrder duration designation isActive",
      populate: {
        path: "designation",
        select: "name",
      },
    })
    .populate({
      path: "designation",
      select: "name",
    })
    .sort({ createdAt: -1 });

  return userProgress;
};
export const getEmployeeProgressForAdminSide = async (userId) => {
  const userProgress = await Progress.find({ employee: userId })
    .populate({
      path: "video",
      select: "title veedUrl sortOrder duration designation isActive",
      populate: {
        path: "designation",
        select: "name",
      },
    })
    .populate({
      path: "designation",
      select: "name",
    })
    .sort({ createdAt: -1 });

  return userProgress;
};
/**
 * Generate/Verify Certificate Eligibility for an Employee
 */
export const getCertificateData = async (userId) => {
  // Fetch all progress records marked completed
  const completedProgress = await Progress.find({
    employee: userId,
    status: "completed",
  }).lean();

  const certificateModules = completedProgress.map((p) => ({
    videoId: p.video,
    videoTitle: p.videoSnapshot?.title || p.video?.title || "Training Module",
    designationName: p.videoSnapshot?.designationName || "",
    completedAt: p.completedAt,
    bestAttempt:
      p.history.filter((h) => h.passed).sort((a, b) => b.score - a.score)[0] ||
      null,
  }));

  return {
    employeeId: userId,
    completedModulesCount: certificateModules.length,
    modules: certificateModules,
  };
};
