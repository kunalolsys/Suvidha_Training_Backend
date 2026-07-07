import { Router } from "express";
import {
  exportByDesignation,
  exportByStore,
  exportFullReport,
} from "../controllers/exportReport.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";
const router = Router();
router.use(protect, authorize("Admin"));

router.get("/by-designation", exportByDesignation);

router.get("/by-store", exportByStore);

router.get("/full", exportFullReport);

export default router;
