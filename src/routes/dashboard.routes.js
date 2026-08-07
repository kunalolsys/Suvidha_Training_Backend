import { Router } from "express";
import {
  getDashboardStats,
  getEmployeeTrainingProgress,
  getVideosByDesignation,
} from "../controllers/dashboard.controller.js";

import { protect } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";
import { exportEmployeeTrainingProgressCSV } from "../services/dashboard.service.js";
const router = Router();

router.use(protect, authorize("Admin"));

// GET /api/dashboard/stats
router.get("/stats", getDashboardStats);

// GET /api/dashboard/employee-progress?page=1&limit=20&search=&store=
router.get("/employee-progress", getEmployeeTrainingProgress);

// GET /api/dashboard/videos-by-designation
router.get("/videos-by-designation", getVideosByDesignation);
router.get("/export-emp-progress", exportEmployeeTrainingProgressCSV);

export default router;
