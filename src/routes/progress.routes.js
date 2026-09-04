import express from "express";
import * as progressController from "../controllers/progress.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { migrateProgressSchema } from "../utils/Migration.js";

const router = express.Router();

router.patch("/update-status", protect, progressController.updateVideoStatus);
router.post("/submit-quiz", protect, progressController.submitQuizAttempt);
router.get("/my-dashboard", protect, progressController.getMyProgress);
router.get("/:id", protect, progressController.getEmpProgress);
router.get("/get-certificate", protect, progressController.getMyCertificateData);
// routes/admin.js
router.post("/migrate-progress",protect, migrateProgressSchema);
export default router;
