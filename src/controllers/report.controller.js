import * as svc from "../services/report.service.js";

const getPeriod = (req) => req.query.period || "all"; // "30" | "90" | "all"

export const getReportStats = async (req, res) => {
  try {
    const data = await svc.getReportStats(getPeriod(req));
    res.json({ success: true, data });
  } catch (err) {
    console.error("[getReportStats]", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getBreakdownByDesignation = async (req, res) => {
  try {
    const data = await svc.getBreakdownByDesignation(getPeriod(req));
    res.json({ success: true, data });
  } catch (err) {
    console.error("[getBreakdownByDesignation]", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getBreakdownByStore = async (req, res) => {
  try {
    const data = await svc.getBreakdownByStore(getPeriod(req));
    res.json({ success: true, data });
  } catch (err) {
    console.error("[getBreakdownByStore]", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getAtRiskEmployees = async (req, res) => {
  try {
    const data = await svc.getAtRiskEmployees(getPeriod(req));
    res.json({ success: true, data });
  } catch (err) {
    console.error("[getAtRiskEmployees]", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getTopPerformers = async (req, res) => {
  try {
    const data = await svc.getTopPerformers(getPeriod(req));
    res.json({ success: true, data });
  } catch (err) {
    console.error("[getTopPerformers]", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// Full page in one round-trip
export const getFullReport = async (req, res) => {
  try {
    const period = getPeriod(req);
    const [stats, byDesignation, byStore, atRisk, topPerformers] =
      await Promise.all([
        svc.getReportStats(period),
        svc.getBreakdownByDesignation(period),
        svc.getBreakdownByStore(period),
        svc.getAtRiskEmployees(period),
        svc.getTopPerformers(period),
      ]);
    res.json({
      success: true,
      data: { stats, byDesignation, byStore, atRisk, topPerformers },
    });
  } catch (err) {
    console.error("[getFullReport]", err);
    res.status(500).json({ success: false, message: err.message });
  }
};
