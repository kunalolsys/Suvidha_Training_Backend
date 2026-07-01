import express from "express";

import * as authController from "../controllers/auth.controller.js";

import { protect } from "../middleware/auth.middleware.js";
import multer from "multer";

const router = express.Router();

router.post("/register", authController.register);

router.post("/login", authController.login);

router.get("/profile", protect, authController.profile);

router.patch("/change-password", protect, authController.changePassword);

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "text/csv" || file.originalname.endsWith(".csv")) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "File type unsupported. Please provide a standard text/csv file.",
        ),
        false,
      );
    }
  },
});

// Attach route handler mapping 'file' property name
router.post(
  "/bulk-import",
  upload.single("file"),
  authController.bulkImportUsers,
);

export default router;
