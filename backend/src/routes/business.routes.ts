import { Router } from "express";

import {
  createBusiness,
  getBusinesses,
  getBusinessById,
  getMyBusiness,
  updateMyBusiness,
  updateBusinessAvatar,
  updateBusinessCover,
  deleteBusinessAvatar,
  deleteBusinessCover,
} from "../controllers/business.controller.js";

import {
  authenticate,
  requireRole,
  requireProfessionalAccess,
} from "../middleware/auth.middleware.js";

import {
  uploadBusinessImage,
} from "../middleware/upload.middleware.js";

const router = Router();
import { getBusinessPhotos, addBusinessPhoto, deleteBusinessPhoto } from '../controllers/business-gallery.controller.js';
router.get('/:id/photos', getBusinessPhotos);
router.post('/me/photos', authenticate, requireRole('PROFESSIONAL'), requireProfessionalAccess, uploadBusinessImage, addBusinessPhoto);
router.delete('/me/photos/:id', authenticate, requireRole('PROFESSIONAL'), requireProfessionalAccess, deleteBusinessPhoto);
router.delete("/me/avatar", authenticate, requireRole("PROFESSIONAL"),
  requireProfessionalAccess, deleteBusinessAvatar);
router.delete("/me/cover", authenticate, requireRole("PROFESSIONAL"),
  requireProfessionalAccess, deleteBusinessCover);


// Rutas públicas
router.get(
  "/",
  getBusinesses
);


// Rutas del profesional autenticado.
// /me debe declararse antes de /:id.
router.get(
  "/me",
  authenticate,
  requireRole("PROFESSIONAL"),
  getMyBusiness
);

router.patch(
  "/me",
  authenticate,
  requireRole("PROFESSIONAL"),
  requireProfessionalAccess,
  updateMyBusiness
);


// Avatar del negocio
router.put(
  "/me/avatar",
  authenticate,
  requireRole("PROFESSIONAL"),
  requireProfessionalAccess,
  uploadBusinessImage,
  updateBusinessAvatar
);


// Portada del negocio
router.put(
  "/me/cover",
  authenticate,
  requireRole("PROFESSIONAL"),
  requireProfessionalAccess,
  uploadBusinessImage,
  updateBusinessCover
);


// Perfil público por ID
router.get(
  "/:id",
  getBusinessById
);


// Crear perfil profesional
router.post(
  "/",
  authenticate,
  requireRole("PROFESSIONAL"),
  requireProfessionalAccess,
  createBusiness
);

export default router;
