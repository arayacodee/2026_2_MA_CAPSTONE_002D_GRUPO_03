import { Router } from "express";

import {
  createAvailability,
  getAvailabilities,
  getAvailabilityById,
  deleteAvailability,
  getAvailableSlots,
  listBlockedDays,
  blockDay,
  unblockDay,
} from "../controllers/availability.controller.js";

import {
  authenticate,
  requireRole,
  requireProfessionalAccess,
} from "../middleware/auth.middleware.js";

const router = Router();
router.get('/blocked-days', authenticate, requireRole('PROFESSIONAL'), listBlockedDays);
router.post('/blocked-days', authenticate, requireRole('PROFESSIONAL'), blockDay);
router.delete('/blocked-days/:day', authenticate, requireRole('PROFESSIONAL'), unblockDay);

router.get(
  "/",
  authenticate,
  getAvailabilities
);

router.get(
  "/slots",
  authenticate,
  requireRole("CLIENT"),
  getAvailableSlots
);

router.get(
  "/:id",
  authenticate,
  getAvailabilityById
);

router.post(
  "/",
  authenticate,
  requireRole("PROFESSIONAL"),
  requireProfessionalAccess,
  createAvailability
);

router.delete(
  "/:id",
  authenticate,
  requireRole("PROFESSIONAL"),
  requireProfessionalAccess,
  deleteAvailability
);


export default router;
