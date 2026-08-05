// services/exportReport.service.js
import XLSX from "xlsx";
import User from "../models/User.js";
import Video from "../models/Video.js";
import Progress from "../models/Progress.js";
import Designation from "../models/Designation.js";
import Store from "../models/Store.js";

// ── Date Filter Helper ───────────────────────────────────────────────────
const buildDateFilter = (period) => {
  if (!period || period === "all") return {};
  const days = Number(period);
  if (!days) return {};
  const from = new Date();
  from.setDate(from.getDate() - days);
  return { createdAt: { $gte: from } };
};

// ─────────────────────────────────────────────────────────────────────────
// BUILD RAW DATA — By Designation
// ─────────────────────────────────────────────────────────────────────────
export const buildDesignationReport = async (period = "all") => {
  const df = buildDateFilter(period);

  const [desigs, allStores, employees, videos] = await Promise.all([
    Designation.find().lean(),
    Store.find().lean(),
    User.find(
      { role: "Employee", isActive: true },
      { _id: 1, store: 1, designation: 1 }
    ).lean(),
    Video.find({ isActive: true }, { designation: 1 }).lean(),
  ]);

  // Count active videos assigned per designation ID
  const videoCountPerDesig = {};
  for (const v of videos) {
    if (Array.isArray(v.designation)) {
      for (const dId of v.designation) {
        const idStr = String(dId);
        videoCountPerDesig[idStr] = (videoCountPerDesig[idStr] || 0) + 1;
      }
    }
  }

  // Group active employees by designation ID
  const empByDesig = {};
  for (const emp of employees) {
    if (!emp.designation) continue;
    const dStr = String(emp.designation);
    if (!empByDesig[dStr]) empByDesig[dStr] = [];
    empByDesig[dStr].push(emp);
  }

  // Single bulk aggregation query for progress stats
  const progressAgg = await Progress.aggregate([
    { $match: { ...df } },
    {
      $group: {
        _id: "$employee",
        completedCount: {
          $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
        },
        totalAttempts: { $sum: "$attempts" },
        firstTryPassed: {
          $max: {
            $cond: [
              {
                $and: [
                  { $gt: [{ $size: { $ifNull: ["$history", []] } }, 0] },
                  { $eq: [{ $arrayElemAt: ["$history.passed", 0] }, true] },
                ],
              },
              1,
              0,
            ],
          },
        },
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
    const assignedVid = videoCountPerDesig[desIdStr] || 0;
    const totalPossible = empCount * assignedVid;

    let completedCount = 0;
    let totalAttempts = 0;
    let firstTryPassedCount = 0;
    let atRisk = 0;

    const storeEmpsMap = {};

    for (const emp of desEmployees) {
      const eIdStr = String(emp._id);
      const prog = empProgressMap[eIdStr];

      if (prog) {
        completedCount += prog.completedCount;
        totalAttempts += prog.totalAttempts;
        if (prog.firstTryPassed) firstTryPassedCount++;
        if (prog.totalAttempts > 0 && prog.hasAnyPass === 0) atRisk++;
      }

      if (emp.store) {
        const sIdStr = String(emp.store);
        if (!storeEmpsMap[sIdStr]) storeEmpsMap[sIdStr] = 0;
        if (prog) storeEmpsMap[sIdStr] += prog.completedCount;
      }
    }

    const completionPct =
      totalPossible > 0
        ? Math.round((completedCount / totalPossible) * 100)
        : 0;

    const firstTryPct =
      empCount > 0 ? Math.round((firstTryPassedCount / empCount) * 100) : 0;

    // Determine Best Store
    let bestStore = "—";
    let bestStorePct = 0;

    for (const [storeId, storeCompleted] of Object.entries(storeEmpsMap)) {
      const storeEmpsCount = desEmployees.filter(
        (e) => String(e.store) === storeId
      ).length;
      const possible = storeEmpsCount * assignedVid;
      const pct = possible > 0 ? Math.round((storeCompleted / possible) * 100) : 0;

      if (pct >= bestStorePct) {
        bestStorePct = pct;
        const storeDoc = allStores.find((s) => String(s._id) === storeId);
        bestStore = storeDoc?.name || "—";
      }
    }

    return {
      Designation: des.name,
      Employees: empCount,
      "Assigned Videos": assignedVid,
      "Total Possible": totalPossible,
      Completed: completedCount,
      "Completion %": `${completionPct}%`,
      "Total Attempts": totalAttempts,
      "First-Try Pass Rate": `${firstTryPct}%`,
      "Best Store": bestStore,
      "Best Store %": `${bestStorePct}%`,
      "At-Risk Employees": atRisk,
    };
  });

  // Sort by Completion % descending
  rows.sort(
    (a, b) => parseInt(b["Completion %"]) - parseInt(a["Completion %"])
  );

  return rows;
};

// ─────────────────────────────────────────────────────────────────────────
// BUILD RAW DATA — By Store
// ─────────────────────────────────────────────────────────────────────────
export const buildStoreReport = async (period = "all") => {
  const df = buildDateFilter(period);

  const [stores, employees, videos] = await Promise.all([
    Store.find().lean(),
    User.find(
      { role: "Employee", isActive: true },
      { _id: 1, store: 1, designation: 1 }
    ).lean(),
    Video.find({ isActive: true }, { designation: 1 }).lean(),
  ]);

  const videoCountPerDesig = {};
  for (const v of videos) {
    if (Array.isArray(v.designation)) {
      for (const dId of v.designation) {
        const idStr = String(dId);
        videoCountPerDesig[idStr] = (videoCountPerDesig[idStr] || 0) + 1;
      }
    }
  }

  const storeEmpMap = {};
  for (const emp of employees) {
    if (!emp.store) continue;
    const sStr = String(emp.store);
    if (!storeEmpMap[sStr]) storeEmpMap[sStr] = [];
    storeEmpMap[sStr].push(emp);
  }

  const progressAgg = await Progress.aggregate([
    { $match: { ...df } },
    {
      $group: {
        _id: "$employee",
        completedCount: {
          $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] },
        },
        totalAttempts: { $sum: "$attempts" },
        firstTryPassed: {
          $max: {
            $cond: [
              {
                $and: [
                  { $gt: [{ $size: { $ifNull: ["$history", []] } }, 0] },
                  { $eq: [{ $arrayElemAt: ["$history.passed", 0] }, true] },
                ],
              },
              1,
              0,
            ],
          },
        },
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
    let firstTryPassedCount = 0;
    let atHundred = 0;
    let atRisk = 0;

    for (const emp of storeEmployees) {
      const dIdStr = String(emp.designation);
      const assignedVideos = videoCountPerDesig[dIdStr] || 0;
      totalPossible += assignedVideos;

      const prog = empProgressMap[String(emp._id)];
      if (prog) {
        completedCount += prog.completedCount;
        totalAttempts += prog.totalAttempts;
        if (prog.firstTryPassed) firstTryPassedCount++;
        if (assignedVideos > 0 && prog.completedCount >= assignedVideos) {
          atHundred++;
        }
        if (prog.totalAttempts > 0 && prog.hasAnyPass === 0) {
          atRisk++;
        }
      }
    }

    const completionPct =
      totalPossible > 0
        ? Math.round((completedCount / totalPossible) * 100)
        : 0;

    const firstTryPct =
      empCount > 0 ? Math.round((firstTryPassedCount / empCount) * 100) : 0;

    return {
      Store: store.name,
      "Store Code": store.code || "—",
      Employees: empCount,
      "Total Possible": totalPossible,
      Completed: completedCount,
      "Completion %": `${completionPct}%`,
      "Total Attempts": totalAttempts,
      "First-Try Pass Rate": `${firstTryPct}%`,
      "Employees at 100%": atHundred,
      "At-Risk Employees": atRisk,
    };
  });

  rows.sort(
    (a, b) => parseInt(b["Completion %"]) - parseInt(a["Completion %"])
  );

  return rows;
};

// ─────────────────────────────────────────────────────────────────────────
// EXPORT AS CSV
// ─────────────────────────────────────────────────────────────────────────
export const buildCSV = (rows, title = "") => {
  if (!rows || !rows.length)
    return title ? `${title}\nNo data available.\n` : "No data available.\n";

  const headers = Object.keys(rows[0]);
  const escape = (val) => `"${String(val ?? "").replace(/"/g, '""')}"`;

  const lines = [
    ...(title
      ? [`# ${title}`, `# Generated: ${new Date().toLocaleString("en-IN")}`]
      : []),
    headers.map(escape).join(","),
    ...rows.map((row) => headers.map((h) => escape(row[h])).join(",")),
  ];

  return lines.join("\r\n");
};

// ─────────────────────────────────────────────────────────────────────────
// EXPORT AS XLSX
// ─────────────────────────────────────────────────────────────────────────
export const buildXLSX = (sheets) => {
  const wb = XLSX.utils.book_new();

  for (const { name, rows, title } of sheets) {
    if (!rows || !rows.length) {
      const ws = XLSX.utils.aoa_to_sheet([["No data available."]]);
      XLSX.utils.book_append_sheet(wb, ws, name);
      continue;
    }

    const headers = Object.keys(rows[0]);

    const aoa = [
      [title || name],
      [`Generated: ${new Date().toLocaleString("en-IN")}`],
      [],
      headers,
      ...rows.map((row) => headers.map((h) => row[h])),
    ];

    const ws = XLSX.utils.aoa_to_sheet(aoa);

    // Set column widths
    ws["!cols"] = headers.map((h) => ({ wch: Math.max(h.length + 4, 18) }));

    XLSX.utils.book_append_sheet(wb, ws, name);
  }

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
};