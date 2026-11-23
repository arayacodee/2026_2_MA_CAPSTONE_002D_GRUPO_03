import { Router } from "express";
import { authenticate, requireRole } from "../middleware/auth.middleware.js";
import { uploadBusinessImage } from "../middleware/upload.middleware.js";
import { getSessions, getAttentionMetrics, updateSession, addEvidence, deleteEvidence } from "../controllers/session.controller.js";

const router = Router();
router.use(authenticate, requireRole("PROFESSIONAL"));
router.get("/", getSessions);
router.get("/metrics", getAttentionMetrics);
router.patch("/:id", updateSession);
router.post("/:id/evidences", uploadBusinessImage, addEvidence);
router.delete("/evidences/:id", deleteEvidence);
export default router;
