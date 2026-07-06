import User from "../models/User.js";
import Video from "../models/Video.js";
import Progress from "../models/Progress.js";
import Designation from "../models/Designation.js";
import Store from "../models/Store.js";

// ── Date filter helper ────────────────────────────────────────────────────
const dateFilter = (period) => {
  if (!period || period === "all") return {};
  const days = Number(period);
  if (!days) return {};
  const from = new Date();
  from.setDate(from.getDate() - days);
  return { createdAt: { $gte: from } };
};

// ─────────────────────────────────────────────────────────────────────────
// 1. TOP STATS  (5 KPI cards on Reports page)
// ─────────────────────────────────────────────────────────────────────────
export const getReportStats = async (period = "all") => {
  const df = dateFilter(period);

  // 1. Fetch total employees and cross-reference total active videos per designation concurrently
  const [totalEmployees, videoCountByDesignation] = await Promise.all([
    User.countDocuments({ role: "Employee", isActive: true }),
    Video.aggregate([
      { $match: { isActive: true } },
      { $group: { _id: "$designation", count: { $sum: 1 } } },
    ]),
  ]);

  // Convert designation video counts into a flat HashMap lookup object for O(1) complexity matching
  const videoCountMap = videoCountByDesignation.reduce((acc, curr) => {
    acc[curr._id.toString()] = curr.count;
    return acc;
  }, {});

  // 2. Execute complex grouping metrics in a single MongoDB aggregation pipeline
  const statsAggregation = await Progress.aggregate([
    {
      $facet: {
        // Core Metric Aggregations (Overall Completion, First-Try Pass Rate, Total Attempts)
        mainMetrics: [
          { $match: df },
          {
            $group: {
              _id: null,
              completedCount: {
                $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
              },
              totalAttempts: { $sum: "$attempts" },
              // Calculations for first try metrics
              firstTryTotal: {
                $sum: {
                  $cond: [
                    { $gt: [{ $size: { $ifNull: ["$history", []] } }, 0] },
                    1,
                    0,
                  ],
                },
              },
              firstTryPassed: {
                $sum: {
                  $cond: [
                    {
                      $and: [
                        { $gt: [{ $size: { $ifNull: ["$history", []] } }, 0] },
                        {
                          $eq: [{ $arrayElemAt: ["$history.passed", 0] }, true],
                        },
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
            },
          },
        ],

        // Metric calculations grouped by Employee (Employees at 100% and Need Attention)
        employeeMetrics: [
          {
            $group: {
              _id: "$employee",
              completedCount: {
                $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
              },
              totalAttempts: { $sum: "$attempts" },
              hasAnyPass: {
                $max: {
                  $cond: [
                    {
                      $gt: [
                        {
                          $size: {
                            $filter: {
                              input: { $ifNull: ["$history", []] },
                              as: "h",
                              cond: { $eq: ["$$h.passed", true] },
                            },
                          },
                        },
                        0,
                      ],
                    },
                    1,
                    0,
                  ],
                },
              },
            },
          },
        ],
      },
    },
  ]);

  // Extract result maps safely out of the aggregation pipeline facets
  const main = statsAggregation[0]?.mainMetrics[0] || {
    completedCount: 0,
    totalAttempts: 0,
    firstTryTotal: 0,
    firstTryPassed: 0,
  };
  const employeeRecords = statsAggregation[0]?.employeeMetrics || [];

  // 3. Optimized in-memory calculations for loop dependencies
  // Stream users to map out totalPossible and check 100% completions using our precalculated HashMap
  const allEmployees = await User.find(
    { role: "Employee", isActive: true },
    { designation: 1 },
  ).lean();

  let totalPossible = 0;
  let atHundredPct = 0;

  // Build an in-memory lookup map of completed counts by employee ID for O(1) performance lookup
  const employeeCompletedMap = employeeRecords.reduce((acc, curr) => {
    acc[curr._id.toString()] = {
      completedCount: curr.completedCount,
      totalAttempts: curr.totalAttempts,
      hasAnyPass: curr.hasAnyPass,
    };
    return acc;
  }, {});

  for (const emp of allEmployees) {
    const empDesignationId = emp.designation?.toString();
    const assignedVideoCount = videoCountMap[empDesignationId] || 0;

    totalPossible += assignedVideoCount;

    const progressData = employeeCompletedMap[emp._id.toString()] || {
      completedCount: 0,
    };
    if (
      assignedVideoCount > 0 &&
      progressData.completedCount >= assignedVideoCount
    ) {
      atHundredPct++;
    }
  }

  // 4. Calculate Need Attention completely in-memory
  const needAttention = employeeRecords.filter(
    (rec) => rec.totalAttempts > 0 && rec.hasAnyPass === 0,
  ).length;

  // Final mathematical processing rules
  const overallCompletion =
    totalPossible > 0
      ? Math.round((main.completedCount / totalPossible) * 100)
      : 0;
  const firstTryPassRate =
    main.firstTryTotal > 0
      ? Math.round((main.firstTryPassed / main.firstTryTotal) * 100)
      : 0;

  return {
    overallCompletion: `${overallCompletion}%`,
    employeesAt100: `${atHundredPct}/${totalEmployees}`,
    firstTryPassRate: `${firstTryPassRate}%`,
    totalQuizAttempts: main.totalAttempts,
    needAttention,
  };
};

// ─────────────────────────────────────────────────────────────────────────
// 2. BREAKDOWN BY DESIGNATION
// ─────────────────────────────────────────────────────────────────────────
export const getBreakdownByDesignation = async (period = "all") => {
  const df = dateFilter(period);
  const desigs = await Designation.find().lean();
  const allStores = await Store.find().lean();

  const rows = await Promise.all(
    desigs.map(async (des) => {
      const employees = await User.find(
        { designation: des._id, role: "Employee", isActive: true },
        { _id: 1, store: 1, name: 1 },
      ).lean();

      const empIds = employees.map((e) => e._id);
      const empCount = empIds.length;

      const assignedVideos = await Video.countDocuments({
        designation: des._id,
        isActive: true,
      });
      const totalPossible = empCount * assignedVideos;

      const completedCount = await Progress.countDocuments({
        employee: { $in: empIds },
        status: "completed",
        ...df,
      });
      const completionPct =
        totalPossible > 0
          ? Math.round((completedCount / totalPossible) * 100)
          : 0;

      // Best store: highest completion % among stores that have employees in this designation
      const storeMap = {};
      for (const emp of employees) {
        const sid = String(emp.store);
        if (!storeMap[sid]) storeMap[sid] = [];
        storeMap[sid].push(emp._id);
      }

      let bestStore = "—",
        bestStorePct = 0;
      for (const [storeId, storeEmpIds] of Object.entries(storeMap)) {
        const sc = await Progress.countDocuments({
          employee: { $in: storeEmpIds },
          status: "completed",
          ...df,
        });
        const possible = storeEmpIds.length * assignedVideos;
        const pct = possible > 0 ? Math.round((sc / possible) * 100) : 0;
        if (pct >= bestStorePct) {
          bestStorePct = pct;
          const storeDoc = allStores.find((s) => String(s._id) === storeId);
          bestStore = storeDoc?.name || "—";
        }
      }

      // At-risk: employees in this designation who attempted but never passed
      const atRiskAgg = await Progress.aggregate([
        { $match: { employee: { $in: empIds }, attempts: { $gt: 0 }, ...df } },
        {
          $group: {
            _id: "$employee",
            anyPass: {
              $max: {
                $cond: [
                  {
                    $gt: [
                      {
                        $size: {
                          $filter: {
                            input: "$history",
                            as: "h",
                            cond: "$$h.passed",
                          },
                        },
                      },
                      0,
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
        { $match: { anyPass: 0 } },
        { $count: "count" },
      ]);
      const atRisk = atRiskAgg[0]?.count || 0;

      return {
        designationId: des._id,
        designation: des.name,
        employees: empCount,
        completionPct,
        completionFrac: `${completedCount}/${totalPossible}`,
        bestStore,
        bestStorePct: `${bestStorePct}%`,
        atRisk,
      };
    }),
  );

  return rows.sort((a, b) => b.completionPct - a.completionPct);
};

// ─────────────────────────────────────────────────────────────────────────
// 3. BREAKDOWN BY STORE
// ─────────────────────────────────────────────────────────────────────────
export const getBreakdownByStore = async (period = "all") => {
  const df = dateFilter(period);
  const stores = await Store.find().lean();

  const rows = await Promise.all(
    stores.map(async (store) => {
      const employees = await User.find(
        { store: store._id, role: "Employee", isActive: true },
        { _id: 1, designation: 1 },
      ).lean();

      const empIds = employees.map((e) => e._id);
      const empCount = empIds.length;

      // Total possible = sum of assigned videos per employee
      let totalPossible = 0;
      for (const emp of employees) {
        const count = await Video.countDocuments({
          designation: emp.designation,
          isActive: true,
        });
        totalPossible += count;
      }

      const completedCount = await Progress.countDocuments({
        employee: { $in: empIds },
        status: "completed",
        ...df,
      });
      const completionPct =
        totalPossible > 0
          ? Math.round((completedCount / totalPossible) * 100)
          : 0;

      const totalAttemptsAgg = await Progress.aggregate([
        { $match: { employee: { $in: empIds }, ...df } },
        { $group: { _id: null, total: { $sum: "$attempts" } } },
      ]);
      const totalAttempts = totalAttemptsAgg[0]?.total || 0;

      const atRiskAgg = await Progress.aggregate([
        { $match: { employee: { $in: empIds }, attempts: { $gt: 0 }, ...df } },
        {
          $group: {
            _id: "$employee",
            anyPass: {
              $max: {
                $cond: [
                  {
                    $gt: [
                      {
                        $size: {
                          $filter: {
                            input: "$history",
                            as: "h",
                            cond: "$$h.passed",
                          },
                        },
                      },
                      0,
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
        { $match: { anyPass: 0 } },
        { $count: "count" },
      ]);
      const atRisk = atRiskAgg[0]?.count || 0;

      return {
        storeId: store._id,
        store: store.name,
        storeCode: store.code,
        employees: empCount,
        completionPct,
        completionFrac: `${completedCount}/${totalPossible}`,
        totalAttempts,
        atRisk,
      };
    }),
  );

  return rows.sort((a, b) => b.completionPct - a.completionPct);
};

// ─────────────────────────────────────────────────────────────────────────
// 4. AT-RISK EMPLOYEES
// ─────────────────────────────────────────────────────────────────────────
export const getAtRiskEmployees = async (period = "all") => {
  const df = dateFilter(period);

  // Employees who have Progress docs with attempts > 0 but zero passes in history
  const atRiskProgressAgg = await Progress.aggregate([
    { $match: { attempts: { $gt: 0 }, ...df } },
    {
      $addFields: {
        passedCount: {
          $size: {
            $filter: { input: "$history", as: "h", cond: "$$h.passed" },
          },
        },
      },
    },
    { $match: { passedCount: 0 } },
    {
      $group: {
        _id: "$employee",
        totalAttempts: { $sum: "$attempts" },
        stuckVideos: { $addToSet: "$video" },
      },
    },
  ]);

  const empIds = atRiskProgressAgg.map((r) => r._id);

  const employees = await User.find(
    { _id: { $in: empIds }, role: "Employee", isActive: true },
    { name: 1, email: 1, designation: 1, store: 1 },
  )
    .populate("designation", "name")
    .populate("store", "name code")
    .lean();

  const result = await Promise.all(
    employees.map(async (emp) => {
      const row = atRiskProgressAgg.find(
        (r) => String(r._id) === String(emp._id),
      );

      const assignedVideos = await Video.countDocuments({
        designation: emp.designation?._id,
        isActive: true,
      });
      const completedCount = await Progress.countDocuments({
        employee: emp._id,
        status: "completed",
      });

      // Video titles they're stuck on
      const stuckTitles = await Video.find(
        { _id: { $in: row?.stuckVideos || [] } },
        { title: 1, videoId: 1 },
      ).lean();

      return {
        _id: emp._id,
        name: emp.name,
        email: emp.email,
        store: emp.store?.name || "—",
        storeCode: emp.store?.code || "—",
        designation: emp.designation?.name || "—",
        completed: `${completedCount}/${assignedVideos}`,
        attempts: row?.totalAttempts || 0,
        passRate: "0%",
        stuckVideos: stuckTitles.map((v) => ({
          videoId: v.videoId,
          title: v.title,
        })),
      };
    }),
  );

  return result;
};

// ─────────────────────────────────────────────────────────────────────────
// 5. TOP PERFORMERS  (100% completion)
// ─────────────────────────────────────────────────────────────────────────
export const getTopPerformers = async (period = "all") => {
  const df = dateFilter(period);

  const employees = await User.find(
    { role: "Employee", isActive: true },
    { name: 1, email: 1, designation: 1, store: 1 },
  )
    .populate("designation", "name")
    .populate("store", "name code")
    .lean();

  const performers = [];

  for (const emp of employees) {
    const assignedVideos = await Video.countDocuments({
      designation: emp.designation?._id,
      isActive: true,
    });
    if (assignedVideos === 0) continue;

    const completedCount = await Progress.countDocuments({
      employee: emp._id,
      status: "completed",
      ...df,
    });
    if (completedCount < assignedVideos) continue;

    const attemptsAgg = await Progress.aggregate([
      { $match: { employee: emp._id, ...df } },
      { $group: { _id: null, total: { $sum: "$attempts" } } },
    ]);

    performers.push({
      _id: emp._id,
      name: emp.name,
      email: emp.email,
      store: emp.store?.name || "—",
      storeCode: emp.store?.code || "—",
      designation: emp.designation?.name || "—",
      completed: `${completedCount}/${assignedVideos}`,
      attempts: attemptsAgg[0]?.total || 0,
      passRate: "100%",
    });
  }

  return performers;
};
