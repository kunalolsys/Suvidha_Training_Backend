import express from "express";
import * as videoController from "../controllers/video.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";

const router = express.Router();

router.post("/", protect, authorize("Admin"), videoController.createVideo);

router.get("/", protect, videoController.getVideos);

router.get("/all", protect, videoController.getAllVideos);

router.get("/:id", protect, videoController.getVideoById);

router.put("/:id", protect, authorize("Admin"), videoController.updateVideo);

router.delete("/:id", protect, authorize("Admin"), videoController.deleteVideo);

export default router;
