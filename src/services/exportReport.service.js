import XLSX from "xlsx";
import User from "../models/User.js";
import Video from "../models/Video.js";
import Progress from "../models/Progress.js";
import Designation from "../models/Designation.js";
import Store from "../models/Store.js";

// ── Date filter helper (reused from reportsService) ───────────────────────
const buildDateFilter = (period) => {
  if (!period || period === "all") return {};
  const days = Number(period);
  if (!days) return {};
  const from = new Date();
  from.setDate(from.getDate() - days);
  return { createdAt: { $gte: from } };
};

// ── Pass rate from Progress history array ─────────────────────────────────
const passRateFromHistory = (historyArr = []) => {
  if (!historyArr.length) return 0;
  const passed = historyArr.filter((h) => h.passed).length;
  return Math.round((passed / historyArr.length) * 100);
};

// ─────────────────────────────────────────────────────────────────────────
// BUILD RAW DATA — By Designation
// Returns array of objects ready for CSV/XLSX
// ─────────────────────────────────────────────────────────────────────────
export const buildDesignationReport = async (period = "all") => {
  const df = buildDateFilter(period);
  const desigs = await Designation.find().lean();
  const allStores = await Store.find().lean();

  const rows = [];

  for (const des of desigs) {
    const employees = await User.find(
      { designation: des._id, role: "Employee", isActive: true },
      { _id: 1, store: 1, name: 1, email: 1 },
    ).lean();

    const empIds = employees.map((e) => e._id);
    const empCount = empIds.length;
    const assignedVid = await Video.countDocuments({
      designation: des._id,
      isActive: true,
    });
    const totalPossible = empCount * assignedVid;

    const completedCount = await Progress.countDocuments({
      employee: { $in: empIds },
      status: "completed",
      ...df,
    });
    const completionPct =
      totalPossible > 0
        ? Math.round((completedCount / totalPossible) * 100)
        : 0;

    // Total quiz attempts across all employees in this designation
    const attAgg = await Progress.aggregate([
      { $match: { employee: { $in: empIds }, ...df } },
      { $group: { _id: null, total: { $sum: "$attempts" } } },
    ]);
    const totalAttempts = attAgg[0]?.total || 0;

    // First-try pass rate
    const firstTryAgg = await Progress.aggregate([
      {
        $match: {
          employee: { $in: empIds },
          "history.0": { $exists: true },
          ...df,
        },
      },
      { $project: { firstAttempt: { $arrayElemAt: ["$history", 0] } } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          passed: { $sum: { $cond: ["$firstAttempt.passed", 1, 0] } },
        },
      },
    ]);
    const firstTryPct =
      firstTryAgg[0]?.total > 0
        ? Math.round((firstTryAgg[0].passed / firstTryAgg[0].total) * 100)
        : 0;

    // At-risk count
    const atRiskAgg = await Progress.aggregate([
      { $match: { employee: { $in: empIds }, attempts: { $gt: 0 }, ...df } },
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
      { $group: { _id: "$employee" } },
      { $count: "count" },
    ]);
    const atRisk = atRiskAgg[0]?.count || 0;

    // Best store for this designation
    const storeMap = {};
    for (const emp of employees) {
      const sid = String(emp.store);
      if (!storeMap[sid]) storeMap[sid] = [];
      storeMap[sid].push(emp._id);
    }

    let bestStore = "—",
      bestStorePct = 0;
    for (const [storeId, sEmpIds] of Object.entries(storeMap)) {
      const sc = await Progress.countDocuments({
        employee: { $in: sEmpIds },
        status: "completed",
        ...df,
      });
      const possible = sEmpIds.length * assignedVid;
      const pct = possible > 0 ? Math.round((sc / possible) * 100) : 0;
      if (pct >= bestStorePct) {
        bestStorePct = pct;
        const storeDoc = allStores.find((s) => String(s._id) === storeId);
        bestStore = storeDoc?.name || "—";
      }
    }

    rows.push({
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
    });
  }

  // Sort by Completion % descending
  rows.sort((a, b) => {
    const pA = parseInt(a["Completion %"]);
    const pB = parseInt(b["Completion %"]);
    return pB - pA;
  });

  return rows;
};

// ─────────────────────────────────────────────────────────────────────────
// BUILD RAW DATA — By Store
// ─────────────────────────────────────────────────────────────────────────
export const buildStoreReport = async (period = "all") => {
  const df = buildDateFilter(period);
  const stores = await Store.find().lean();

  const rows = [];

  for (const store of stores) {
    const employees = await User.find(
      { store: store._id, role: "Employee", isActive: true },
      { _id: 1, designation: 1 },
    ).lean();

    const empIds = employees.map((e) => e._id);
    const empCount = empIds.length;

    // Total possible = sum of assigned videos per employee's designation
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

    const attAgg = await Progress.aggregate([
      { $match: { employee: { $in: empIds }, ...df } },
      { $group: { _id: null, total: { $sum: "$attempts" } } },
    ]);
    const totalAttempts = attAgg[0]?.total || 0;

    // First-try pass rate
    const firstTryAgg = await Progress.aggregate([
      {
        $match: {
          employee: { $in: empIds },
          "history.0": { $exists: true },
          ...df,
        },
      },
      { $project: { firstAttempt: { $arrayElemAt: ["$history", 0] } } },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          passed: { $sum: { $cond: ["$firstAttempt.passed", 1, 0] } },
        },
      },
    ]);
    const firstTryPct =
      firstTryAgg[0]?.total > 0
        ? Math.round((firstTryAgg[0].passed / firstTryAgg[0].total) * 100)
        : 0;

    // At-risk
    const atRiskAgg = await Progress.aggregate([
      { $match: { employee: { $in: empIds }, attempts: { $gt: 0 }, ...df } },
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
      { $group: { _id: "$employee" } },
      { $count: "count" },
    ]);
    const atRisk = atRiskAgg[0]?.count || 0;

    // Employees at 100% within this store
    let atHundred = 0;
    for (const emp of employees) {
      const assigned = await Video.countDocuments({
        designation: emp.designation,
        isActive: true,
      });
      if (assigned === 0) continue;
      const completed = await Progress.countDocuments({
        employee: emp._id,
        status: "completed",
      });
      if (completed >= assigned) atHundred++;
    }

    rows.push({
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
    });
  }

  rows.sort(
    (a, b) => parseInt(b["Completion %"]) - parseInt(a["Completion %"]),
  );
  return rows;
};

// ─────────────────────────────────────────────────────────────────────────
// EXPORT AS CSV  (no dependency — pure string)
// ─────────────────────────────────────────────────────────────────────────
export const buildCSV = (rows, title = "") => {
  if (!rows.length)
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
// EXPORT AS XLSX  (requires: npm install xlsx)
// Returns a Buffer ready to pipe as a download
// ─────────────────────────────────────────────────────────────────────────
export const buildXLSX = (sheets) => {
  // sheets = [{ name: "By Designation", rows: [...] }, { name: "By Store", rows: [...] }]
  const wb = XLSX.utils.book_new();

  for (const { name, rows, title } of sheets) {
    if (!rows.length) {
      const ws = XLSX.utils.aoa_to_sheet([["No data available."]]);
      XLSX.utils.book_append_sheet(wb, ws, name);
      continue;
    }

    const headers = Object.keys(rows[0]);

    // Build AOA: title row → generated row → blank → header → data
    const aoa = [
      [title || name],
      [`Generated: ${new Date().toLocaleString("en-IN")}`],
      [],
      headers,
      ...rows.map((row) => headers.map((h) => row[h])),
    ];

    const ws = XLSX.utils.aoa_to_sheet(aoa);

    // Column widths
    ws["!cols"] = headers.map((h) => ({ wch: Math.max(h.length + 4, 18) }));

    // Bold + background for header row (row index 3 = 4th row)
    const headerRowIdx = 3;
    headers.forEach((_, c) => {
      const cellAddr = XLSX.utils.encode_cell({ r: headerRowIdx, c });
      if (ws[cellAddr]) {
        ws[cellAddr].s = {
          font: { bold: true, color: { rgb: "FFFFFF" } },
          fill: { fgColor: { rgb: "C0143C" } }, // Suvidha pink
          alignment: { horizontal: "center" },
        };
      }
    });

    // Alternating row fill for data rows
    rows.forEach((_, ri) => {
      const rowIdx = headerRowIdx + 1 + ri;
      const fill = ri % 2 === 0 ? "FFF5F8" : "FFFFFF"; // light pink alternating
      headers.forEach((_, c) => {
        const cellAddr = XLSX.utils.encode_cell({ r: rowIdx, c });
        if (ws[cellAddr]) {
          ws[cellAddr].s = { fill: { fgColor: { rgb: fill } } };
        }
      });
    });

    XLSX.utils.book_append_sheet(wb, ws, name);
  }

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx", cellStyles: true });
};
