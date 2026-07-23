import express from "express";
import * as videoController from "../controllers/vimeo.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";

const router = express.Router();

router.get("/:videoId", videoController.getVimeoVideoById);
router.get("/", videoController.getAllVimeoVideos);
export default router;
