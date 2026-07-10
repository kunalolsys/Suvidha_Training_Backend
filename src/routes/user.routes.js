import express from "express";
import * as userController from "../controllers/user.controller.js";
import { protect } from "../middleware/auth.middleware.js";

import { authorize } from "../middleware/role.middleware.js";
import { syncStuEmployees } from "../services/user.service.js";

const router = express.Router();

router.get("/", protect, authorize("Admin"), userController.getUsers);

router.put("/:id", protect, authorize("Admin"), userController.updateUser);

router.post("/sync-stu-employees", protect, authorize("Admin"), syncStuEmployees);

export default router;
