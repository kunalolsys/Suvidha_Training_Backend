import express from "express";
import authRoutes from "./auth.routes.js";
import storeRoutes from "./store.routes.js";
import designationRoutes from "./designation.routes.js";
import videoRoutes from "./video.routes.js";
import questionsRoutes from "./question.routes.js";
import reportRoutes from "./report.routes.js";
import userRoutes from "./user.routes.js";

const router = express.Router();
router.use("/auth", authRoutes);
router.use("/stores", storeRoutes);
router.use("/designation", designationRoutes);
router.use("/videos", videoRoutes);
router.use("/questions", questionsRoutes);
router.use("/reports", reportRoutes);
router.use("/users", userRoutes);

export default router;

