import express from "express";
import * as questionController from "../controllers/question.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";

const router = express.Router();

router.post(
  "/",
  protect,
  authorize("Admin"),
  questionController.createQuestion,
);

router.get("/", protect, questionController.getQuestions);
router.get("/:videoId", protect, questionController.getQuestionsPerVideo);

router.get("/:id", protect, questionController.getQuestionById);

router.put(
  "/:id",
  protect,
  authorize("Admin"),
  questionController.updateQuestion,
);

router.delete(
  "/:id",
  protect,
  authorize("Admin"),
  questionController.deleteQuestion,
);

export default router;
