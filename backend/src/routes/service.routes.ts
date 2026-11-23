import { Router } from "express";

import {
  createService,
  getServices,
  getServiceById,
  updateService,
} from "../controllers/service.controller.js";

import {
  authenticate,
  requireRole,
  requireProfessionalAccess,
} from "../middleware/auth.middleware.js";

const router = Router();

router.get(
  "/",
  getServices
);

router.get(
  "/:id",
  getServiceById
);

router.post(
  "/",
  authenticate,
  requireRole("PROFESSIONAL"),
  requireProfessionalAccess,
  createService
);

router.patch(
  "/:id",
  authenticate,
  requireRole("PROFESSIONAL"),
  requireProfessionalAccess,
  updateService
);

export default router;
