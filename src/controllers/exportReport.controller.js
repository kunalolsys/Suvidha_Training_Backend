// controllers/exportReport.controller.js
import * as exportSvc from "../services/exportReport.service.js";
import asyncHandler from "../middleware/asyncHandler.js";

const getPeriod = (req) => req.query.period || "all"; // "30" | "90" | "all"
const getFormat = (req) => (req.query.format || "xlsx").toLowerCase(); // "csv" | "xlsx"

const periodLabel = (period) => {
  if (period === "30") return "Last 30 Days";
  if (period === "90") return "Last 90 Days";
  return "All Time";
};

// ── GET /api/export/by-designation?period=all&format=xlsx ─────────────────
export const exportByDesignation = asyncHandler(async (req, res) => {
  const period = getPeriod(req);
  const format = getFormat(req);
  const rows = await exportSvc.buildDesignationReport(period);
  const label = periodLabel(period);
  const title = `Performance Breakdown by Designation — ${label}`;

  if (format === "csv") {
    const csv = exportSvc.buildCSV(rows, title);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="breakdown-by-designation-${period}.csv"`,
    );
    return res.status(200).send(csv);
  }

  // Default: XLSX
  const buffer = exportSvc.buildXLSX([{ name: "By Designation", rows, title }]);

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="breakdown-by-designation-${period}.xlsx"`,
  );
  return res.status(200).send(Buffer.from(buffer));
});

// ── GET /api/export/by-store?period=all&format=xlsx ───────────────────────
export const exportByStore = asyncHandler(async (req, res) => {
  const period = getPeriod(req);
  const format = getFormat(req);
  const rows = await exportSvc.buildStoreReport(period);
  const label = periodLabel(period);
  const title = `Performance Breakdown by Store — ${label}`;

  if (format === "csv") {
    const csv = exportSvc.buildCSV(rows, title);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="breakdown-by-store-${period}.csv"`,
    );
    return res.status(200).send(csv);
  }

  const buffer = exportSvc.buildXLSX([{ name: "By Store", rows, title }]);

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="breakdown-by-store-${period}.xlsx"`,
  );
  return res.status(200).send(Buffer.from(buffer));
});

// ── GET /api/export/full?period=all&format=xlsx ───────────────────────────
export const exportFullReport = asyncHandler(async (req, res) => {
  const period = getPeriod(req);
  const format = getFormat(req);
  const label = periodLabel(period);

  const [desgRows, storeRows] = await Promise.all([
    exportSvc.buildDesignationReport(period),
    exportSvc.buildStoreReport(period),
  ]);

  if (format === "csv") {
    const desgCSV = exportSvc.buildCSV(
      desgRows,
      `Performance by Designation — ${label}`,
    );
    const storeCSV = exportSvc.buildCSV(
      storeRows,
      `Performance by Store — ${label}`,
    );
    const combined = `${desgCSV}\r\n\r\n${storeCSV}`;

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="full-report-${period}.csv"`,
    );
    return res.status(200).send(combined);
  }

  // XLSX: multi-sheet workbook
  const buffer = exportSvc.buildXLSX([
    {
      name: "By Designation",
      rows: desgRows,
      title: `Performance by Designation — ${label}`,
    },
    {
      name: "By Store",
      rows: storeRows,
      title: `Performance by Store — ${label}`,
    },
  ]);

  res.setHeader(
    "Content-Type",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="full-report-${period}.xlsx"`,
  );
  return res.status(200).send(Buffer.from(buffer));
});
