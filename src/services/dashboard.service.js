import User from "../models/User.js";
import Video from "../models/Video.js";
import Question from "../models/Question.js";
import Progress from "../models/Progress.js";
import Designation from "../models/Designation.js";
import Store from "../models/Store.js";

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

  // Build employee filter
  const empFilter = { role: "Employee", isActive: true };
  if (storeId) empFilter.store = storeId;
  if (search) {
    empFilter.$or = [
      { name: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
    ];
  }

  const [employees, total] = await Promise.all([
    User.find(empFilter)
      .populate("designation", "name")
      .populate("store", "name code")
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
