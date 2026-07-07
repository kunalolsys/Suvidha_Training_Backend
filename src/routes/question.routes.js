import express from "express";
import * as questionController from "../controllers/question.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";
import multer from "multer";
const upload = multer({
  dest: "uploads/",
  fileFilter: (req, file, cb) => {
    // Only accept Excel mimetypes
    if (
      file.mimetype ===
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      file.mimetype === "application/vnd.ms-excel"
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only Excel files (.xlsx, .xls) are allowed"), false);
    }
  },
});
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
router.post(
  "/import/:videoId",
  protect,
  authorize("Admin"),
  upload.single("file"), // Middleware captures 'file' from your frontend request payload
  questionController.bulkImportQuestions, // Linked wrapper controller method
);
export default router;
