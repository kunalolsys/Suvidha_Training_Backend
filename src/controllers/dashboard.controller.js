import * as svc from "../services/dashboard.service.js";

export const getDashboardStats = async (req, res) => {
  try {
    const data = await svc.getDashboardStats();
    res.json({ success: true, data });
  } catch (err) {
    console.error("[getDashboardStats]", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getEmployeeTrainingProgress = async (req, res) => {
  try {
    const { page = 1, limit = 20, search = "", store = "" } = req.query;
    const result = await svc.getEmployeeTrainingProgress({
      page: Number(page),
      limit: Number(limit),
      search,
      storeId: store, // pass store ObjectId string from query
    });
    res.json({ success: true, ...result });
  } catch (err) {
    console.error("[getEmployeeTrainingProgress]", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getVideosByDesignation = async (req, res) => {
  try {
    const data = await svc.getVideosByDesignation();
    res.json({ success: true, data });
  } catch (err) {
    console.error("[getVideosByDesignation]", err);
    res.status(500).json({ success: false, message: err.message });
  }
};
