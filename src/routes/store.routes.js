import express from "express";

import * as storeController from "../controllers/store.controller.js";

import { protect } from "../middleware/auth.middleware.js";

import { authorize } from "../middleware/role.middleware.js";

const router = express.Router();

router.post("/", protect, authorize("Admin"), storeController.createStore);

router.get("/", protect, authorize("Admin"), storeController.getStores);

router.get("/all", protect, authorize("Admin"), storeController.getAllStores);

router.get("/:id", protect, authorize("Admin"), storeController.getStoreById);

router.put("/:id", protect, authorize("Admin"), storeController.updateStore);

router.delete("/:id", protect, authorize("Admin"), storeController.deleteStore);

export default router;
