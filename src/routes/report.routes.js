import { Router } from "express";
import * as reportController from "../controllers/report.controller.js";

import { protect } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";
const router = Router();

router.use(protect, authorize("Admin"));

// GET /api/reports?period=30|90|all   ← full page in one shot
router.get("/", reportController.getFullReport);
router.get("/stats", reportController.getReportStats);
router.get("/by-designation", reportController.getBreakdownByDesignation);
router.get("/by-store", reportController.getBreakdownByStore);
router.get("/at-risk", reportController.getAtRiskEmployees);
router.get("/top-performers", reportController.getTopPerformers);

export default router;
