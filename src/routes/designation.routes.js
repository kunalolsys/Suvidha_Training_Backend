import express from "express";
import * as designationController from "../controllers/designation.controller.js";
import { protect } from "../middleware/auth.middleware.js";
import { authorize } from "../middleware/role.middleware.js";

const router = express.Router();

router.post(
  "/",
  protect,
  authorize("Admin"),
  designationController.createDesignation,
);

router.get(
  "/",
  protect,
  authorize("Admin"),
  designationController.getDesignations,
);

router.get(
  "/:id",
  protect,
  authorize("Admin"),
  designationController.getDesignationById,
);

router.put(
  "/:id",
  protect,
  authorize("Admin"),
  designationController.updateDesignation,
);

router.delete(
  "/:id",
  protect,
  authorize("Admin"),
  designationController.deleteDesignation,
);

export default router;
