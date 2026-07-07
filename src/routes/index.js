import express from "express";
import authRoutes from "./auth.routes.js";
import storeRoutes from "./store.routes.js";
import designationRoutes from "./designation.routes.js";
import videoRoutes from "./video.routes.js";
import questionsRoutes from "./question.routes.js";
import reportRoutes from "./report.routes.js";
import userRoutes from "./user.routes.js";
import progressRoutes from "./progress.routes.js";
import dashboardRoutes from "./dashboard.routes.js";
import exportReportRoutes from "./exportReport.routes.js";

const router = express.Router();
router.use("/auth", authRoutes);
router.use("/stores", storeRoutes);
router.use("/designation", designationRoutes);
router.use("/videos", videoRoutes);
router.use("/questions", questionsRoutes);
router.use("/users", userRoutes);
router.use("/progress", progressRoutes);

router.use("/reports", reportRoutes);
router.use("/dashboard", dashboardRoutes);
router.use("/export", exportReportRoutes);
export default router;

