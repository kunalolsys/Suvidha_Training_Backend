import express from "express";
import * as progressController from "../controllers/progress.controller.js";
import { protect } from "../middleware/auth.middleware.js";

const router = express.Router();

router.patch("/update-status", protect, progressController.updateVideoStatus);
router.post("/submit-quiz", protect, progressController.submitQuizAttempt);
router.get("/my-dashboard", protect, progressController.getMyProgress);

export default router;
