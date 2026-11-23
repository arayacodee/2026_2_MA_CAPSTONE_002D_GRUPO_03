import { Router } from "express";

import {
  createReservation,
  getReservations,
  getReservationById,
  cancelReservation,
  completeReservation,
  rescheduleReservation,
  markNoShow,
} from "../controllers/reservation.controller.js";

import {
  authenticate,
  requireRole,
} from "../middleware/auth.middleware.js";

const router = Router();

router.use(authenticate);
router.use(requireRole('CLIENT', 'PROFESSIONAL'));

router.get(
  "/",
  getReservations
);

router.get(
  "/:id",
  getReservationById
);

router.post(
  "/",
  requireRole("CLIENT"),
  createReservation
);

router.patch(
  "/:id/cancel",
  cancelReservation
);

// Una atención completada solo puede ser registrada
// por el profesional propietario del negocio.
router.patch(
  "/:id/complete",
  requireRole("PROFESSIONAL"),
  completeReservation
);

router.patch('/:id/reschedule', requireRole('PROFESSIONAL'), rescheduleReservation);
router.patch('/:id/no-show', requireRole('PROFESSIONAL'), markNoShow);

export default router;
