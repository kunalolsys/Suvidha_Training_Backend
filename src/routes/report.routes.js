import express from "express";

import * as reportController from "../controllers/report.controller.js";

import { protect } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";

const router = express.Router();

router.get(
  "/dashboard",
  protect,
  authorize("Admin"),
  reportController.getDashboard,
);

router.get(
  "/employees",
  protect,
  authorize("Admin"),
  reportController.getEmployees,
);
router.get(
  "/employees/:id",
  protect,
  authorize("Admin"),
  reportController.getEmployeeById,
);

router.get("/stores", protect, authorize("Admin"), reportController.getStores);
router.get(
  "/designations",
  protect,
  authorize("Admin"),
  reportController.getDesignations,
);

router.get("/videos", protect, authorize("Admin"), reportController.getVideos);
router.get(
  "/top-performers",
  protect,
  authorize("Admin"),
  reportController.getTopPerformers,
);

router.get(
  "/failed",
  protect,
  authorize("Admin"),
  reportController.getFailedEmployees,
);
router.get(
  "/activity",
  protect,
  authorize("Admin"),
  reportController.getActivity,
);

router.get(
  "/export",
  protect,
  authorize("Admin"),
  reportController.exportReport,
);

export default router;
