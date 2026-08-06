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
// 1. TOP STATS (5 KPI cards on Reports page)
// ─────────────────────────────────────────────────────────────────────────
export const getReportStats = async (period = "all") => {
  const df = dateFilter(period);

  // 1. Fetch total employees and active videos
  const [totalEmployees, activeVideos] = await Promise.all([
    User.countDocuments({ role: "Employee", isActive: true }),
    Video.find({ isActive: true }, { _id: 1, designation: 1 }).lean(),
  ]);

  const activeVideoIds = activeVideos.map((v) => v._id);

  // Map active videos per designation
  const videoCountMap = {};
  for (const v of activeVideos) {
    if (Array.isArray(v.designation)) {
      for (const dId of v.designation) {
        const idStr = String(dId);
        videoCountMap[idStr] = (videoCountMap[idStr] || 0) + 1;
      }
    }
  }

  // 2. Aggregate progress metrics ONLY for ACTIVE videos
  const statsAggregation = await Progress.aggregate([
    {
      $match: {
        video: { $in: activeVideoIds },
        ...df,
      },
    },
    {
      $facet: {
        mainMetrics: [
          {
            $group: {
              _id: null,
              completedCount: {
                $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
              },
              totalAttempts: { $sum: "$attempts" },
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

  const main = statsAggregation[0]?.mainMetrics[0] || {
    completedCount: 0,
    totalAttempts: 0,
    firstTryTotal: 0,
    firstTryPassed: 0,
  };
  const employeeRecords = statsAggregation[0]?.employeeMetrics || [];

  // 3. Fetch active employees to calculate total possible video completions
  const allEmployees = await User.find(
    { role: "Employee", isActive: true },
    { designation: 1 },
  ).lean();

  let totalPossible = 0;
  let atHundredPct = 0;

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

  // 4. Calculate at-risk employees
  const needAttention = employeeRecords.filter(
    (rec) => rec.totalAttempts > 0 && rec.hasAnyPass === 0,
  ).length;

  const overallCompletion =
    totalPossible > 0
      ? Math.round((main.completedCount / totalPossible) * 100)
      : 0;
  const firstTryPassRate =
    main.firstTryTotal > 0
      ? Math.round((main.firstTryPassed / main.firstTryTotal) * 100)
      : 0;

  return {
    overallCompletion: `${Math.min(overallCompletion, 100)}%`,
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

  const [desigs, allStores, employees, videos] = await Promise.all([
    Designation.find().lean(),
    Store.find().lean(),
    User.find(
      { role: "Employee", isActive: true },
      { _id: 1, store: 1, designation: 1 },
    ).lean(),
    Video.find({ isActive: true }, { designation: 1 }).lean(),
  ]);

  const activeVideoIds = videos.map((v) => v._id);

  // Map designation IDs to total assigned videos
  const videoCountPerDesig = {};
  for (const v of videos) {
    if (Array.isArray(v.designation)) {
      for (const dId of v.designation) {
        const idStr = String(dId);
        videoCountPerDesig[idStr] = (videoCountPerDesig[idStr] || 0) + 1;
      }
    }
  }

  // Group employee IDs by designation
  const empByDesig = {};
  for (const emp of employees) {
    if (!emp.designation) continue;
    const dStr = String(emp.designation);
    if (!empByDesig[dStr]) empByDesig[dStr] = [];
    empByDesig[dStr].push(emp);
  }

  // Progress aggregation ONLY for ACTIVE videos
  const progressAgg = await Progress.aggregate([
    { $match: { video: { $in: activeVideoIds }, ...df } },
    {
      $group: {
        _id: "$employee",
        completedCount: {
          $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
        },
        hasAttempts: { $sum: "$attempts" },
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
  ]);

  const empProgressMap = progressAgg.reduce((acc, curr) => {
    acc[String(curr._id)] = curr;
    return acc;
  }, {});

  const rows = desigs.map((des) => {
    const desIdStr = String(des._id);
    const desEmployees = empByDesig[desIdStr] || [];
    const empCount = desEmployees.length;
    const assignedVideos = videoCountPerDesig[desIdStr] || 0;
    const totalPossible = empCount * assignedVideos;

    let completedCount = 0;
    let atRisk = 0;

    const storeEmpsMap = {};

    for (const emp of desEmployees) {
      const eIdStr = String(emp._id);
      const prog = empProgressMap[eIdStr];

      if (prog) {
        // Cap completed count per employee to assignedVideos count to prevent > 100%
        completedCount += Math.min(prog.completedCount, assignedVideos);
        if (prog.hasAttempts > 0 && prog.hasAnyPass === 0) {
          atRisk++;
        }
      }

      if (emp.store) {
        const sIdStr = String(emp.store);
        if (!storeEmpsMap[sIdStr]) storeEmpsMap[sIdStr] = 0;
        if (prog)
          storeEmpsMap[sIdStr] += Math.min(prog.completedCount, assignedVideos);
      }
    }

    const completionPct =
      totalPossible > 0
        ? Math.round((completedCount / totalPossible) * 100)
        : 0;

    // Determine Best Store
    let bestStore = "—";
    let bestStorePct = 0;

    for (const [storeId, storeCompleted] of Object.entries(storeEmpsMap)) {
      const storeEmpsCount = desEmployees.filter(
        (e) => String(e.store) === storeId,
      ).length;
      const possible = storeEmpsCount * assignedVideos;
      const pct =
        possible > 0 ? Math.round((storeCompleted / possible) * 100) : 0;

      if (pct >= bestStorePct) {
        bestStorePct = Math.min(pct, 100);
        const storeDoc = allStores.find((s) => String(s._id) === storeId);
        bestStore = storeDoc?.name || "—";
      }
    }

    return {
      designationId: des._id,
      designation: des.name,
      employees: empCount,
      completionPct: Math.min(completionPct, 100),
      completionFrac: `${completedCount}/${totalPossible}`,
      bestStore,
      bestStorePct: `${Math.min(bestStorePct, 100)}%`,
      atRisk,
    };
  });

  return rows.sort((a, b) => b.completionPct - a.completionPct);
};

// ─────────────────────────────────────────────────────────────────────────
// 3. BREAKDOWN BY STORE
// ─────────────────────────────────────────────────────────────────────────
export const getBreakdownByStore = async (period = "all") => {
  const df = dateFilter(period);

  const [stores, employees, videos] = await Promise.all([
    Store.find().lean(),
    User.find(
      { role: "Employee", isActive: true },
      { _id: 1, store: 1, designation: 1 },
    ).lean(),
    Video.find({ isActive: true }, { designation: 1 }).lean(),
  ]);

  const activeVideoIds = videos.map((v) => v._id);

  // Video count map per designation
  const videoCountPerDesig = {};
  for (const v of videos) {
    if (Array.isArray(v.designation)) {
      for (const dId of v.designation) {
        const idStr = String(dId);
        videoCountPerDesig[idStr] = (videoCountPerDesig[idStr] || 0) + 1;
      }
    }
  }

  // Group employees by store
  const storeEmpMap = {};
  for (const emp of employees) {
    if (!emp.store) continue;
    const sStr = String(emp.store);
    if (!storeEmpMap[sStr]) storeEmpMap[sStr] = [];
    storeEmpMap[sStr].push(emp);
  }

  // Progress aggregation ONLY for ACTIVE videos
  const progressAgg = await Progress.aggregate([
    { $match: { video: { $in: activeVideoIds }, ...df } },
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
  ]);

  const empProgressMap = progressAgg.reduce((acc, curr) => {
    acc[String(curr._id)] = curr;
    return acc;
  }, {});

  const rows = stores.map((store) => {
    const storeIdStr = String(store._id);
    const storeEmployees = storeEmpMap[storeIdStr] || [];
    const empCount = storeEmployees.length;

    let totalPossible = 0;
    let completedCount = 0;
    let totalAttempts = 0;
    let atRisk = 0;

    for (const emp of storeEmployees) {
      const dIdStr = String(emp.designation);
      const assignedVideos = videoCountPerDesig[dIdStr] || 0;
      totalPossible += assignedVideos;

      const prog = empProgressMap[String(emp._id)];
      if (prog) {
        completedCount += Math.min(prog.completedCount, assignedVideos);
        totalAttempts += prog.totalAttempts;
        if (prog.totalAttempts > 0 && prog.hasAnyPass === 0) {
          atRisk++;
        }
      }
    }

    const completionPct =
      totalPossible > 0
        ? Math.round((completedCount / totalPossible) * 100)
        : 0;

    return {
      storeId: store._id,
      store: store.name,
      storeCode: store.code,
      employees: empCount,
      completionPct: Math.min(completionPct, 100),
      completionFrac: `${completedCount}/${totalPossible}`,
      totalAttempts,
      atRisk,
    };
  });

  return rows.sort((a, b) => b.completionPct - a.completionPct);
};

// ─────────────────────────────────────────────────────────────────────────
// 4. AT-RISK EMPLOYEES
// ─────────────────────────────────────────────────────────────────────────
export const getAtRiskEmployees = async (period = "all") => {
  const df = dateFilter(period);

  const activeVideos = await Video.find({ isActive: true }, { _id: 1 }).lean();
  const activeVideoIds = activeVideos.map((v) => v._id);

  const atRiskProgressAgg = await Progress.aggregate([
    { $match: { video: { $in: activeVideoIds }, attempts: { $gt: 0 }, ...df } },
    {
      $addFields: {
        passedCount: {
          $size: {
            $filter: {
              input: { $ifNull: ["$history", []] },
              as: "h",
              cond: { $eq: ["$$h.passed", true] },
            },
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
        designation: { $in: [emp.designation?._id] },
        isActive: true,
      });

      const completedCount = await Progress.countDocuments({
        employee: emp._id,
        video: { $in: activeVideoIds },
        status: "completed",
      });

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
        completed: `${Math.min(completedCount, assignedVideos)}/${assignedVideos}`,
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
// 5. TOP PERFORMERS (100% completion)
// ─────────────────────────────────────────────────────────────────────────
export const getTopPerformers = async (period = "all") => {
  const df = dateFilter(period);

  // 1. Fetch active employees and active video IDs in parallel (2 DB queries)
  const [employees, activeVideos] = await Promise.all([
    User.find(
      { role: "Employee", isActive: true },
      { name: 1, email: 1, designation: 1, store: 1 },
    )
      .populate("designation", "name")
      .populate("store", "name code")
      .lean(),
    Video.find({ isActive: true }, { designation: 1 }).lean(),
  ]);

  const activeVideoIds = activeVideos.map((v) => v._id);

  // 2. Count active assigned videos grouped per designation in memory
  const videoCountPerDesig = {};
  for (const v of activeVideos) {
    if (Array.isArray(v.designation)) {
      for (const dId of v.designation) {
        const idStr = String(dId);
        videoCountPerDesig[idStr] = (videoCountPerDesig[idStr] || 0) + 1;
      }
    }
  }

  // 3. Bulk aggregate progress metrics for ALL active employees (1 DB query)
  const progressAgg = await Progress.aggregate([
    {
      $match: {
        video: { $in: activeVideoIds },
        ...df,
      },
    },
    {
      $group: {
        _id: "$employee",
        completedCount: {
          $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
        },
        totalAttempts: { $sum: "$attempts" },
      },
    },
  ]);

  // Index progress results by employee ID for O(1) lookup speed
  const empProgressMap = progressAgg.reduce((acc, curr) => {
    acc[String(curr._id)] = curr;
    return acc;
  }, {});

  // 4. Build top performers list in memory
  const performers = [];

  for (const emp of employees) {
    const desigId = emp.designation?._id ? String(emp.designation._id) : null;
    if (!desigId) continue;

    const assignedVideos = videoCountPerDesig[desigId] || 0;
    if (assignedVideos === 0) continue;

    const prog = empProgressMap[String(emp._id)];
    const completedCount = prog?.completedCount || 0;

    // Check if employee has completed all assigned videos
    if (completedCount >= assignedVideos) {
      performers.push({
        _id: emp._id,
        name: emp.name,
        email: emp.email,
        store: emp.store?.name || "—",
        storeCode: emp.store?.code || "—",
        designation: emp.designation?.name || "—",
        completed: `${assignedVideos}/${assignedVideos}`,
        attempts: prog?.totalAttempts || 0,
        passRate: "100%",
      });
    }
  }

  return performers;
};
