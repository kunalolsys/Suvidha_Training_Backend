import User from "../models/User.js";
import Video from "../models/Video.js";
import Question from "../models/Question.js";
import Progress from "../models/Progress.js";
import Designation from "../models/Designation.js";
import Store from "../models/Store.js";
import { Parser } from "json2csv";
// ── Helper: pass rate from a Progress doc's history array ─────────────────
const calcPassRate = (historyArr = []) => {
  if (!historyArr.length) return 0;
  const passed = historyArr.filter((h) => h.passed).length;
  return Math.round((passed / historyArr.length) * 100);
};

// ─────────────────────────────────────────────────────────────────────────
// 1. TOP STATS  (6 KPI cards on Admin Dashboard)
// ─────────────────────────────────────────────────────────────────────────
export const getDashboardStats = async () => {
  const [totalEmployees, totalVideos, totalQuestions] = await Promise.all([
    User.countDocuments({ role: "Employee", isActive: true }),
    Video.countDocuments({ isActive: true }),
    Question.countDocuments(),
  ]);

  // completions = Progress docs where status === "completed"
  const completions = await Progress.countDocuments({ status: "completed" });

  // totalAttempts = sum of all attempts field across all Progress docs
  const attemptsAgg = await Progress.aggregate([
    { $group: { _id: null, total: { $sum: "$attempts" } } },
  ]);
  const totalAttempts = attemptsAgg[0]?.total || 0;

  // avgPassRate = across all history entries
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
// 2. EMPLOYEE TRAINING PROGRESS TABLE
// ─────────────────────────────────────────────────────────────────────────
export const getEmployeeTrainingProgress = async ({
  page = 1,
  limit = 20,
  search = "",
  storeId = "",
} = {}) => {
  const skip = (page - 1) * limit;

  // Build employee filter with Name, Email, and Employee Code search
  const empFilter = { role: "Employee", isActive: true };
  if (storeId) empFilter.store = storeId;
  if (search) {
    empFilter.$or = [
      { name: { $regex: search, $options: "i" } },
      // { email: { $regex: search, $options: "i" } },
      { employeeId: { $regex: search, $options: "i" } }, // 👈 Added Employee Code search
    ];
  }

  const [employees, total] = await Promise.all([
    User.find(empFilter)
      .populate("designation", "name")
      .populate("store", "name employeeId")
      .skip(skip)
      .limit(limit)
      .lean(),
    User.countDocuments(empFilter),
  ]);

  const rows = await Promise.all(
    employees.map(async (emp) => {
      // Total videos assigned to this employee's designation
      const totalVideos = await Video.countDocuments({
        designation: emp.designation?._id,
        isActive: true,
      });

      // Progress records for this employee
      const progressDocs = await Progress.find({ employee: emp._id }).lean();

      const completedCount = progressDocs.filter(
        (p) => p.status === "completed",
      ).length;

      // Total attempts = sum of .attempts across all their Progress docs
      const totalAttempts = progressDocs.reduce(
        (sum, p) => sum + (p.attempts || 0),
        0,
      );

      // Pass rate: across all history entries for this employee
      const allHistory = progressDocs.flatMap((p) => p.history || []);
      const passRate = calcPassRate(allHistory);

      return {
        _id: emp._id,
        name: emp.name,
        code: emp.employeeId || "—", // 👈 Included Employee Code
        email: emp.email,
        store: emp.store?.name || "—",
        storeCode: emp.store?.code || "—",
        designation: emp.designation?.name || "—",
        videos: totalVideos,
        completed: `${completedCount}/${totalVideos}`,
        completedCount,
        attempts: totalAttempts,
        passRate: `${passRate}%`,
        passRateNum: passRate,
      };
    }),
  );

  return {
    data: rows,
    pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
  };
};
// ─────────────────────────────────────────────────────────────────────────
// 3. VIDEOS BY DESIGNATION  (Screen 2 grid cards)
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

  // Sort by designation name alphabetically
  result.sort((a, b) => a.designation.localeCompare(b.designation));
  return result;
};
// ─────────────────────────────────────────────────────────────────────────
// 4.EXPORT EMPLOYEE TRAINING PROGRESS TABLE
// ─────────────────────────────────────────────────────────────────────────
export const exportEmployeeTrainingProgressCSV = async (req, res) => {
  try {
    const { search = "", storeId = "" } = req.query;

    // 1. Build employee filter with Name, Email, and Employee Code search
    const empFilter = { role: "Employee", isActive: true };
    if (storeId) empFilter.store = new mongoose.Types.ObjectId(storeId);
    if (search) {
      empFilter.$or = [
        { name: { $regex: search, $options: "i" } },
        // { email: { $regex: search, $options: "i" } },
        { employeeId: { $regex: search, $options: "i" } }, // 👈 Added Employee Code search
      ];
    }

    // 2. Fetch all matching employees in parallel with pre-calculated aggregations
    const [employees, videoCountsByDesignation, progressByEmployee] =
      await Promise.all([
        // Query 1: Fetch searched/filtered employees
        User.find(empFilter)
          .populate("designation", "name")
          .populate("store", "name employeeId")
          .select("name employeeId designation store") // 👈 Included 'code'
          .lean(),

        // Query 2: Aggregate total active videos grouped by designation
        Video.aggregate([
          { $match: { isActive: true } },
          { $group: { _id: "$designation", totalVideos: { $sum: 1 } } },
        ]),

        // Query 3: Aggregate completed count, total attempts, and history by employee
        Progress.aggregate([
          {
            $group: {
              _id: "$employee",
              completedCount: {
                $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
              },
              totalAttempts: { $sum: "$attempts" },
              allHistory: { $push: "$history" },
            },
          },
        ]),
      ]);

    // 3. Create fast O(1) Lookup Maps
    const videoCountMap = new Map(
      videoCountsByDesignation.map((v) => [String(v._id), v.totalVideos]),
    );

    const progressMap = new Map(
      progressByEmployee.map((p) => [
        String(p._id),
        {
          completedCount: p.completedCount || 0,
          totalAttempts: p.totalAttempts || 0,
          history: (p.allHistory || []).flat(2).filter(Boolean),
        },
      ]),
    );

    // 4. Map rows in memory (0 extra DB calls)
    const rows = employees.map((emp) => {
      const desgId = emp.designation?._id ? String(emp.designation._id) : null;
      const empId = String(emp._id);

      const totalVideos = desgId ? videoCountMap.get(desgId) || 0 : 0;
      const empProgress = progressMap.get(empId) || {
        completedCount: 0,
        totalAttempts: 0,
        history: [],
      };

      const passRate = calcPassRate(empProgress.history);

      return {
        "Employee Code": emp.employeeId || "", // 👈 Added to CSV columns
        "Employee Name": emp.name || "",
        Store: emp.store?.name || "",
        "Store Code": emp.store?.code || "",
        Designation: emp.designation?.name || "",
        "Total Videos Assigned": totalVideos,
        "Videos Completed": empProgress.completedCount,
        "Total Attempts": empProgress.totalAttempts,
        "Pass Rate (%)": `${passRate}%`,
      };
    });

    // 5. Generate CSV Output
    const fields = [
      "Employee Code",
      "Employee Name",
      "Store",
      "Store Code",
      "Designation",
      "Total Videos Assigned",
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
