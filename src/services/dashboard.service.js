import User from "../models/User.js";
import Video from "../models/Video.js";
import Question from "../models/Question.js";
import Progress from "../models/Progress.js";
import Designation from "../models/Designation.js";
import Store from "../models/Store.js";
import { Parser } from "json2csv";
import mongoose from "mongoose";

// ─────────────────────────────────────────────────────────────────────────
// 1. TOP STATS (6 KPI cards on Admin Dashboard)
// ─────────────────────────────────────────────────────────────────────────
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
      ? Math.round((passRateAgg[0].passed / passRateAgg[0].total) * 100)
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

// ─────────────────────────────────────────────────────────────────────────
// 2. EMPLOYEE TRAINING PROGRESS TABLE (FIXED & MATCHED TO PROGRESS MODEL)
// ─────────────────────────────────────────────────────────────────────────
export const getEmployeeTrainingProgress = async ({
  page = 1,
  limit = 20,
  search = "",
  storeId = "",
} = {}) => {
  const skip = (page - 1) * limit;

  // 1. Build Filter
  const empFilter = { role: "Employee", isActive: true };
  if (storeId) empFilter.store = storeId;
  if (search) {
    empFilter.$or = [
      { name: { $regex: search, $options: "i" } },
      { employeeId: { $regex: search, $options: "i" } },
    ];
  }

  // 2. Fetch paginated employees
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
    ),
  ];

  // 3. Parallel Aggregation Queries
  const [videoStatsByDesignation, progressByEmployee] = await Promise.all([
    // A) Get Total Videos & Total Questions assigned to each Designation
    Video.aggregate([
      { $match: { designation: { $in: designationIds }, isActive: true } },
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
          totalQuestions: { $sum: { $size: "$questions" } }, // Total Questions e.g. 11
        },
      },
    ]),

    // B) Fetch Employee's Progress Docs with Attempt History & Snapshots
    Progress.find({ employee: { $in: employeeIds } })
      .select("employee video status attempts history")
      .lean(),
  ]);

  // 4. Create Fast Lookup Maps
  const desgStatsMap = new Map(
    videoStatsByDesignation.map((v) => [
      String(v._id),
      { totalVideos: v.totalVideos || 0, totalQuestions: v.totalQuestions || 0 },
    ])
  );

  // Group progress docs by employee ID
  const progressMap = new Map();
  progressByEmployee.forEach((p) => {
    const empKey = String(p.employee);
    if (!progressMap.has(empKey)) {
      progressMap.set(empKey, []);
    }
    progressMap.get(empKey).push(p);
  });

  // 5. Construct Result Rows
  const rows = employees.map((emp) => {
    const desgId = emp.designation?._id ? String(emp.designation._id) : null;
    const empId = String(emp._id);

    const desgStats = desgId
      ? desgStatsMap.get(desgId) || { totalVideos: 0, totalQuestions: 0 }
      : { totalVideos: 0, totalQuestions: 0 };

    const userProgressList = progressMap.get(empId) || [];

    let completedCount = 0;
    let totalAttempts = 0;
    const correctQuestionIds = new Set();

    userProgressList.forEach((pDoc) => {
      if (pDoc.status === "completed") completedCount++;
      totalAttempts += pDoc.attempts || 0;

      // Scan history snapshots for correct questions
      (pDoc.history || []).forEach((attempt) => {
        (attempt.snapshot || []).forEach((qSnap) => {
          if (qSnap.isCorrect && qSnap.questionId) {
            correctQuestionIds.add(String(qSnap.questionId));
          }
        });
      });
    });

    const totalQuestions = desgStats.totalQuestions; // e.g. 11
    const passedQuestions = correctQuestionIds.size; // e.g. 6

    // Pass Rate Calculation: (6 / 11) * 100 = 55%
    const passRateNum =
      totalQuestions > 0
        ? Math.min(100, Math.round((passedQuestions / totalQuestions) * 100))
        : 0;

    return {
      _id: emp._id,
      name: emp.name,
      code: emp.employeeId || "—",
      email: emp.email,
      store: emp.store?.name || "—",
      storeCode: emp.store?.code || "—",
      designation: emp.designation?.name || "—",
      videos: desgStats.totalVideos,
      totalQuestions: totalQuestions,
      passedQuestions: passedQuestions,
      completed: `${completedCount}/${desgStats.totalVideos}`,
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

// ─────────────────────────────────────────────────────────────────────────
// 3. VIDEOS BY DESIGNATION (Screen 2 grid cards)
// ─────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────
// 4. EXPORT EMPLOYEE TRAINING PROGRESS TABLE (CSV)
// ─────────────────────────────────────────────────────────────────────────
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
      const correctQuestionIds = new Set();

      userProgressList.forEach((pDoc) => {
        if (pDoc.status === "completed") completedCount++;
        totalAttempts += pDoc.attempts || 0;

        (pDoc.history || []).forEach((attempt) => {
          (attempt.snapshot || []).forEach((qSnap) => {
            if (qSnap.isCorrect && qSnap.questionId) {
              correctQuestionIds.add(String(qSnap.questionId));
            }
          });
        });
      });

      const totalQuestions = desgStats.totalQuestions;
      const passedQuestions = correctQuestionIds.size;

      const passRateNum =
        totalQuestions > 0
          ? Math.min(100, Math.round((passedQuestions / totalQuestions) * 100))
          : 0;

      return {
        "Employee Code": emp.employeeId || "",
        "Employee Name": emp.name || "",
        Store: emp.store?.name || "",
        "Store Code": emp.store?.code || "",
        Designation: emp.designation?.name || "",
        "Total Videos Assigned": desgStats.totalVideos,
        "Total Questions": totalQuestions,
        "Questions Passed": passedQuestions,
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