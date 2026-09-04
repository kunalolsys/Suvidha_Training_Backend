import User from "../models/User.js";
import Video from "../models/Video.js";
import Question from "../models/Question.js";
import Progress from "../models/Progress.js";
import Designation from "../models/Designation.js";
import Store from "../models/Store.js";
import { Parser } from "json2csv";
import mongoose from "mongoose";

// ── Safe Calculation Helper ──────────────────────────────────────────────────
const calcPassRate = (passedCount = 0, totalCount = 0) => {
  if (!totalCount || totalCount <= 0) return 0;
  const rate = (passedCount / totalCount) * 100;
  return Number(Math.min(100, rate).toFixed(2));
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. TOP STATS
// ─────────────────────────────────────────────────────────────────────────────
export const getDashboardStats = async () => {
  const [totalEmployees, totalVideos, totalQuestions] = await Promise.all([
    User.countDocuments({ role: "Employee", isActive: true }),
    Video.countDocuments({ isActive: true }),
    Question.countDocuments(),
  ]);

  const completions = await Progress.countDocuments({ status: "completed" });

  const attemptsAgg = await Progress.aggregate([
    { $group: { _id: null, total: { $sum: "$attempts" } } },
  ]);
  const totalAttempts = attemptsAgg[0]?.total || 0;

  const passRateAgg = await Progress.aggregate([
    { $unwind: "$history" },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        passed: { $sum: { $cond: ["$history.passed", 1, 0] } },
      },
    },
  ]);
  const avgPassRate =
    passRateAgg[0]?.total > 0
      ? Number(
          ((passRateAgg[0].passed / passRateAgg[0].total) * 100).toFixed(2),
        )
      : 0;

  return {
    totalEmployees,
    totalVideos,
    totalQuestions,
    completions,
    totalAttempts,
    avgPassRate,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// 2. EMPLOYEE TRAINING PROGRESS TABLE (ACCURATE MULTI-FORMAT SUPPORT)
// ─────────────────────────────────────────────────────────────────────────────
export const getEmployeeTrainingProgress = async ({
  page = 1,
  limit = 20,
  search = "",
  storeId = "",
} = {}) => {
  const skip = (page - 1) * limit;

  // 1. Filter Users
  const empFilter = { role: "Employee", isActive: true };
  if (storeId) empFilter.store = storeId;
  if (search) {
    empFilter.$or = [
      { name: { $regex: search, $options: "i" } },
      { employeeId: { $regex: search, $options: "i" } },
    ];
  }

  // 2. Fetch Employees
  const [employees, total] = await Promise.all([
    User.find(empFilter)
      .populate("designation", "name")
      .populate("store", "name employeeId code")
      .skip(skip)
      .limit(limit)
      .lean(),
    User.countDocuments(empFilter),
  ]);

  if (!employees.length) {
    return {
      data: [],
      pagination: { total: 0, page, limit, totalPages: 0 },
    };
  }

  const employeeIds = employees.map((emp) => emp._id);
  const designationIds = [
    ...new Set(
      employees
        .map((emp) => emp.designation?._id)
        .filter((id) => id != null)
        .map(String),
    ),
  ].map((id) => new mongoose.Types.ObjectId(id));

  // 3. Parallel Database Queries
  const [videoStatsByDesignation, progressDocs] = await Promise.all([
    Video.aggregate([
      { $match: { designation: { $in: designationIds }, isActive: true } },
      { $unwind: "$designation" },
      { $match: { designation: { $in: designationIds } } },
      {
        $lookup: {
          from: "questions",
          localField: "_id",
          foreignField: "video",
          as: "questions",
        },
      },
      {
        $group: {
          _id: "$designation",
          totalVideos: { $sum: 1 },
          totalQuestions: { $sum: { $size: "$questions" } },
        },
      },
    ]),

    Progress.find({ employee: { $in: employeeIds } })
      .select("employee video status attempts history")
      .lean(),
  ]);

  // Fast Lookup Maps
  const desgStatsMap = new Map(
    videoStatsByDesignation.map((v) => [
      String(v._id),
      {
        totalVideos: v.totalVideos || 0,
        totalQuestions: v.totalQuestions || 0,
      },
    ]),
  );

  const progressMap = new Map();
  progressDocs.forEach((p) => {
    const empKey = String(p.employee);
    if (!progressMap.has(empKey)) {
      progressMap.set(empKey, []);
    }
    progressMap.get(empKey).push(p);
  });

  // 4. Rows Generation
  const rows = employees.map((emp) => {
    const desgId = emp.designation?._id ? String(emp.designation._id) : null;
    const empId = String(emp._id);

    const desgStats = desgId
      ? desgStatsMap.get(desgId) || { totalVideos: 0, totalQuestions: 0 }
      : { totalVideos: 0, totalQuestions: 0 };

    const userProgressList = progressMap.get(empId) || [];

    let completedCount = 0;
    let totalAttempts = 0;
    let totalCorrectQuestions = 0;
    let totalAttemptedQuestions = 0;

    userProgressList.forEach((pDoc) => {
      if (pDoc.status === "completed") completedCount++;
      totalAttempts += pDoc.attempts || 0;

      const history = pDoc.history || [];
      if (history.length > 0) {
        // Pick the latest attempt from history array
        const latestAttempt = history[history.length - 1];

        let latestCorrect = 0;
        let latestTotalQ = latestAttempt.totalQuestions || 0;

        // Mode 1: Evaluate using snapshot array
        if (latestAttempt.snapshot && latestAttempt.snapshot.length > 0) {
          latestTotalQ = latestAttempt.snapshot.length;
          latestCorrect = latestAttempt.snapshot.filter(
            (q) => q.isCorrect,
          ).length;
        }
        // Mode 2: Score field fallback
        else if (
          latestAttempt.score !== undefined &&
          latestAttempt.score !== null
        ) {
          if (latestAttempt.score <= latestTotalQ) {
            latestCorrect = latestAttempt.score;
          } else {
            latestCorrect = Math.round(
              (latestAttempt.score / 100) * latestTotalQ,
            );
          }
        }

        totalCorrectQuestions += latestCorrect;
        totalAttemptedQuestions += latestTotalQ;
      }
    });

    const totalVideosAssigned =
      desgStats.totalVideos > 0
        ? desgStats.totalVideos
        : userProgressList.length;

    // Pass rate based on total correct vs total attempted questions
    const passRateNum = calcPassRate(
      totalCorrectQuestions,
      totalAttemptedQuestions,
    );

    return {
      _id: emp._id,
      name: emp.name,
      code: emp.employeeId || "—",
      email: emp.email,
      store: emp.store?.name || "—",
      storeCode: emp.store?.code || "—",
      designation: emp.designation?.name || "—",
      videos: totalVideosAssigned,
      totalQuestions: totalAttemptedQuestions,
      passedQuestions: totalCorrectQuestions,
      completed: `${completedCount}/${totalVideosAssigned}`,
      completedCount,
      attempts: totalAttempts,
      passRate: `${passRateNum}%`,
      passRateNum: passRateNum,
    };
  });

  return {
    data: rows,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    },
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. VIDEOS BY DESIGNATION
// ─────────────────────────────────────────────────────────────────────────────
export const getVideosByDesignation = async () => {
  const designations = await Designation.find().lean();

  const result = await Promise.all(
    designations.map(async (des) => {
      const [videoCount, employeeCount] = await Promise.all([
        Video.countDocuments({ designation: des._id, isActive: true }),
        User.countDocuments({
          designation: des._id,
          role: "Employee",
          isActive: true,
        }),
      ]);

      const sampleVideos = await Video.find(
        { designation: des._id, isActive: true },
        { title: 1, duration: 1, videoId: 1 },
      )
        .limit(5)
        .lean();

      return {
        designationId: des._id,
        designation: des.name,
        trainingVideos: videoCount,
        employees: employeeCount,
        sampleVideos,
      };
    }),
  );

  result.sort((a, b) => a.designation.localeCompare(b.designation));
  return result;
};

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT EMPLOYEE TRAINING PROGRESS TABLE (LATEST ATTEMPT BASED EVALUATION)
// ─────────────────────────────────────────────────────────────────────────────
export const exportEmployeeTrainingProgressCSV = async (req, res) => {
  try {
    const { search = "", storeId = "" } = req.query;

    const empFilter = { role: "Employee", isActive: true };
    if (storeId) empFilter.store = new mongoose.Types.ObjectId(storeId);
    if (search) {
      empFilter.$or = [
        { name: { $regex: search, $options: "i" } },
        { employeeId: { $regex: search, $options: "i" } },
      ];
    }

    const [employees, videoStatsByDesignation, progressDocs] =
      await Promise.all([
        User.find(empFilter)
          .populate("designation", "name")
          .populate("store", "name employeeId code")
          .select("name employeeId designation store")
          .lean(),

        Video.aggregate([
          { $match: { isActive: true } },
          { $unwind: "$designation" },
          {
            $lookup: {
              from: "questions",
              localField: "_id",
              foreignField: "video",
              as: "questions",
            },
          },
          {
            $group: {
              _id: "$designation",
              totalVideos: { $sum: 1 },
              totalQuestions: { $sum: { $size: "$questions" } },
            },
          },
        ]),

        Progress.find().select("employee status attempts history").lean(),
      ]);

    const desgStatsMap = new Map(
      videoStatsByDesignation.map((v) => [
        String(v._id),
        {
          totalVideos: v.totalVideos || 0,
          totalQuestions: v.totalQuestions || 0,
        },
      ]),
    );

    const progressMap = new Map();
    progressDocs.forEach((p) => {
      const empKey = String(p.employee);
      if (!progressMap.has(empKey)) {
        progressMap.set(empKey, []);
      }
      progressMap.get(empKey).push(p);
    });

    const rows = employees.map((emp) => {
      const desgId = emp.designation?._id ? String(emp.designation._id) : null;
      const empId = String(emp._id);

      const desgStats = desgId
        ? desgStatsMap.get(desgId) || { totalVideos: 0, totalQuestions: 0 }
        : { totalVideos: 0, totalQuestions: 0 };

      const userProgressList = progressMap.get(empId) || [];

      let completedCount = 0;
      let totalAttempts = 0;
      let totalCorrectQuestions = 0;
      let totalAttemptedQuestions = 0;

      userProgressList.forEach((pDoc) => {
        if (pDoc.status === "completed") completedCount++;
        totalAttempts += pDoc.attempts || 0;

        const history = pDoc.history || [];
        if (history.length > 0) {
          // 1. Always target the LATEST attempt from history array
          const latestAttempt = history[history.length - 1];

          let latestCorrect = 0;
          let latestTotalQ = latestAttempt.totalQuestions || 0;

          // Mode 1: Evaluate using snapshot array
          if (latestAttempt.snapshot && latestAttempt.snapshot.length > 0) {
            latestTotalQ = latestAttempt.snapshot.length;
            latestCorrect = latestAttempt.snapshot.filter(
              (q) => q.isCorrect,
            ).length;
          }
          // Mode 2: Score field fallback
          else if (
            latestAttempt.score !== undefined &&
            latestAttempt.score !== null
          ) {
            if (latestAttempt.score <= latestTotalQ) {
              latestCorrect = latestAttempt.score;
            } else {
              latestCorrect = Math.round(
                (latestAttempt.score / 100) * latestTotalQ,
              );
            }
          }

          totalCorrectQuestions += latestCorrect;
          totalAttemptedQuestions += latestTotalQ;
        }
      });

      const totalVideosAssigned =
        desgStats.totalVideos > 0
          ? desgStats.totalVideos
          : userProgressList.length;

      // Pass rate based on latest attempt correct answers vs latest attempt total questions
      const passRateNum = calcPassRate(
        totalCorrectQuestions,
        totalAttemptedQuestions,
      );

      return {
        "Employee Code": emp.employeeId || "",
        "Employee Name": emp.name || "",
        Store: emp.store?.name || "",
        "Store Code": emp.store?.code || "",
        Designation: emp.designation?.name || "",
        "Total Videos Assigned": totalVideosAssigned,
        "Total Questions": totalAttemptedQuestions,
        "Questions Passed": totalCorrectQuestions,
        "Videos Completed": completedCount,
        "Total Attempts": totalAttempts,
        "Pass Rate (%)": `${passRateNum}%`,
      };
    });

    const fields = [
      "Employee Code",
      "Employee Name",
      "Store",
      "Store Code",
      "Designation",
      "Total Videos Assigned",
      "Total Questions",
      "Questions Passed",
      "Videos Completed",
      "Total Attempts",
      "Pass Rate (%)",
    ];

    const json2csvParser = new Parser({ fields });
    const csv = json2csvParser.parse(rows);

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=employee_training_progress_${Date.now()}.csv`,
    );

    return res.status(200).send(csv);
  } catch (error) {
    console.error("CSV Export Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to export CSV file",
      error: error.message,
    });
  }
};


//**Videos by designation helper functions */
// Helper: Convert "MM:SS" or "HH:MM:SS" to total seconds
const parseDurationToSeconds = (durationStr) => {
  if (!durationStr || typeof durationStr !== "string") return 0;
  const parts = durationStr.split(":").map(Number);
  if (parts.some(isNaN)) return 0;

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return Number(durationStr) || 0;
};

// Helper: Convert seconds back to HH:MM:SS format
const formatSecondsToTime = (totalSeconds) => {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (num) => String(num).padStart(2, "0");
  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
};

export const exportVideosByDesignationReportCSV = async (req, res) => {
  try {
    const { search = "" } = req.query;

    const desgFilter = {};
    if (search) {
      desgFilter.name = { $regex: search, $options: "i" };
    }

    const [designations, videosByDesignation, employeeCounts] = await Promise.all([
      // 1. Fetch Designations
      Designation.find(desgFilter).sort({ name: 1 }).lean(),

      // 2. Fetch Active Videos mapped with Questions
      Video.aggregate([
        { $match: { isActive: true } },
        { $unwind: "$designation" },
        {
          $lookup: {
            from: "questions",
            localField: "_id",
            foreignField: "video",
            as: "questions",
          },
        },
        {
          $project: {
            designation: 1,
            videoId: 1,
            title: 1,
            duration: 1,
            sortOrder: 1,
            questionCount: { $size: "$questions" },
          },
        },
        { $sort: { sortOrder: 1 } },
      ]),

      // 3. Count Active Employees per Designation
      User.aggregate([
        { $match: { role: "Employee", isActive: true } },
        {
          $group: {
            _id: "$designation",
            activeEmployees: { $sum: 1 },
          },
        },
      ]),
    ]);

    // Map Active Employees count by Designation ID
    const empCountMap = new Map(
      employeeCounts.map((e) => [String(e._id), e.activeEmployees])
    );

    // Group Videos by Designation ID
    const videosMap = new Map();
    videosByDesignation.forEach((vid) => {
      const desgId = String(vid.designation);
      if (!videosMap.has(desgId)) {
        videosMap.set(desgId, []);
      }
      videosMap.get(desgId).push(vid);
    });

    // Build Rows for CSV
    const rows = designations.map((desg) => {
      const desgId = String(desg._id);
      const desgVideos = videosMap.get(desgId) || [];
      const totalEmployees = empCountMap.get(desgId) || 0;

      let totalDurationInSeconds = 0;
      let totalQuestions = 0;

      const videoTitlesList = desgVideos
        .map((v) => {
          totalDurationInSeconds += parseDurationToSeconds(v.duration);
          totalQuestions += v.questionCount || 0;
          return `[${v.videoId || "N/A"}] ${v.title}`;
        })
        .join(" | ");

      return {
        "Designation Name": desg.name || "N/A",
        "Active Employees": totalEmployees,
        "Total Training Videos": desgVideos.length,
        "Total Questions": totalQuestions,
        // "Total Training Duration": formatSecondsToTime(totalDurationInSeconds),
        "Video Titles": videoTitlesList || "No videos assigned",
      };
    });

    const fields = [
      "Designation Name",
      "Active Employees",
      "Total Training Videos",
      "Total Questions",
      // "Total Training Duration",
      "Video Titles",
    ];

    const json2csvParser = new Parser({ fields });
    const csv = json2csvParser.parse(rows);

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename=videos_by_designation_report_${Date.now()}.csv`
    );

    return res.status(200).send(csv);
  } catch (error) {
    console.error("Videos by Designation CSV Export Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to export Videos by Designation CSV report",
      error: error.message,
    });
  }
};