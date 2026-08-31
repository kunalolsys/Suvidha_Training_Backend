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
      ? Number(((passRateAgg[0].passed / passRateAgg[0].total) * 100).toFixed(2))
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
        .map(String)
    ),
  ].map((id) => new mongoose.Types.ObjectId(id));

  // 3. Parallel Database Queries
  const [videoStatsByDesignation, progressDocs] = await Promise.all([
    // Videos group by Designation array
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

    // Fetch progress docs for matched employees
    Progress.find({ employee: { $in: employeeIds } })
      .select("employee video status attempts history")
      .lean(),
  ]);

  // Fast Lookup Maps
  const desgStatsMap = new Map(
    videoStatsByDesignation.map((v) => [
      String(v._id),
      { totalVideos: v.totalVideos || 0, totalQuestions: v.totalQuestions || 0 },
    ])
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
    let historyTotalQuestionsSum = 0;

    userProgressList.forEach((pDoc) => {
      if (pDoc.status === "completed") completedCount++;
      totalAttempts += pDoc.attempts || 0;

      // Extract best attempt score for each video
      let bestAttemptCorrect = 0;
      let videoQuestionCount = 0;

      (pDoc.history || []).forEach((attempt) => {
        let attemptCorrect = 0;
        let attemptTotalQ = attempt.totalQuestions || 0;

        // Mode 1: Snapshot items
        if (attempt.snapshot && attempt.snapshot.length > 0) {
          attemptTotalQ = attempt.snapshot.length;
          attemptCorrect = attempt.snapshot.filter((q) => q.isCorrect).length;
        } 
        // Mode 2: Score field fallback
        else if (attempt.score !== undefined && attempt.score !== null) {
          if (attempt.score <= attemptTotalQ) {
            attemptCorrect = attempt.score;
          } else {
            // If score is recorded in percentage (e.g. 100 or 20)
            attemptCorrect = Math.round((attempt.score / 100) * attemptTotalQ);
          }
        }

        if (attemptCorrect > bestAttemptCorrect) {
          bestAttemptCorrect = attemptCorrect;
        }
        if (attemptTotalQ > videoQuestionCount) {
          videoQuestionCount = attemptTotalQ;
        }
      });

      totalCorrectQuestions += bestAttemptCorrect;
      historyTotalQuestionsSum += videoQuestionCount;
    });

    // Total questions fallback if designation mapping is empty
    const totalQuestions =
      desgStats.totalQuestions > 0
        ? desgStats.totalQuestions
        : historyTotalQuestionsSum;

    const totalVideosAssigned =
      desgStats.totalVideos > 0
        ? desgStats.totalVideos
        : userProgressList.length;

    const passRateNum = calcPassRate(totalCorrectQuestions, totalQuestions);

    return {
      _id: emp._id,
      name: emp.name,
      code: emp.employeeId || "—",
      email: emp.email,
      store: emp.store?.name || "—",
      storeCode: emp.store?.code || "—",
      designation: emp.designation?.name || "—",
      videos: totalVideosAssigned,
      totalQuestions: totalQuestions,
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
        { title: 1, duration: 1, videoId: 1 }
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
    })
  );

  result.sort((a, b) => a.designation.localeCompare(b.designation));
  return result;
};

// ─────────────────────────────────────────────────────────────────────────────
// 4. EXPORT EMPLOYEE TRAINING PROGRESS TABLE
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

        Progress.find()
          .select("employee status attempts history")
          .lean(),
      ]);

    const desgStatsMap = new Map(
      videoStatsByDesignation.map((v) => [
        String(v._id),
        { totalVideos: v.totalVideos || 0, totalQuestions: v.totalQuestions || 0 },
      ])
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
      let historyTotalQuestionsSum = 0;

      userProgressList.forEach((pDoc) => {
        if (pDoc.status === "completed") completedCount++;
        totalAttempts += pDoc.attempts || 0;

        let bestAttemptCorrect = 0;
        let videoQuestionCount = 0;

        (pDoc.history || []).forEach((attempt) => {
          let attemptCorrect = 0;
          let attemptTotalQ = attempt.totalQuestions || 0;

          if (attempt.snapshot && attempt.snapshot.length > 0) {
            attemptTotalQ = attempt.snapshot.length;
            attemptCorrect = attempt.snapshot.filter((q) => q.isCorrect).length;
          } else if (attempt.score !== undefined && attempt.score !== null) {
            if (attempt.score <= attemptTotalQ) {
              attemptCorrect = attempt.score;
            } else {
              attemptCorrect = Math.round((attempt.score / 100) * attemptTotalQ);
            }
          }

          if (attemptCorrect > bestAttemptCorrect) {
            bestAttemptCorrect = attemptCorrect;
          }
          if (attemptTotalQ > videoQuestionCount) {
            videoQuestionCount = attemptTotalQ;
          }
        });

        totalCorrectQuestions += bestAttemptCorrect;
        historyTotalQuestionsSum += videoQuestionCount;
      });

      const totalQuestions =
        desgStats.totalQuestions > 0
          ? desgStats.totalQuestions
          : historyTotalQuestionsSum;

      const totalVideosAssigned =
        desgStats.totalVideos > 0
          ? desgStats.totalVideos
          : userProgressList.length;

      const passRateNum = calcPassRate(totalCorrectQuestions, totalQuestions);

      return {
        "Employee Code": emp.employeeId || "",
        "Employee Name": emp.name || "",
        Store: emp.store?.name || "",
        "Store Code": emp.store?.code || "",
        Designation: emp.designation?.name || "",
        "Total Videos Assigned": totalVideosAssigned,
        "Total Questions": totalQuestions,
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
      `attachment; filename=employee_training_progress_${Date.now()}.csv`
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