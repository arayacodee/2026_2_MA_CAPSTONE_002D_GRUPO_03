import type { Request, Response } from "express";
import { z } from "zod";

import { prisma } from "../lib/prisma.js";

import { uploadImageBuffer } from "../lib/cloudinary-upload.js";
import { cloudinary } from "../lib/cloudinary.js";
import { randomUUID } from "node:crypto";
import { businessProfileFields } from '../lib/business-profile.js';
import { bookingOwnerSelect, canReceiveBookings } from '../lib/subscriptions.js';

const createBusinessSchema = z.object({
  ...businessProfileFields,
  name: z.string().trim().min(2).max(100),
  description: z.string().max(500).optional(),
});

const updateBusinessSchema = z
  .object({
    ...businessProfileFields,
    name: z.string().trim().min(2).max(100).optional(),
    description: z.string().max(500).nullable().optional(),
  })
  .refine(
    (data) => Object.keys(data).length > 0,
    {
      message: "At least one field is required",
    }
  );

export const createBusiness = async (
  req: Request,
  res: Response
) => {
  const result = createBusinessSchema.safeParse(req.body);

  if (!result.success) {
    return res.status(400).json({
      error: "Invalid request data",
      details: result.error.flatten(),
    });
  }

  const ownerId = req.authUser!.id;

  try {
    // En el MVP cada profesional utiliza un perfil principal.
    // Evitamos crear perfiles duplicados accidentalmente.
    const existingBusiness =
      await prisma.business.findFirst({
        where: {
          ownerId,
        },
      });

    if (existingBusiness) {
      return res.status(409).json({
        error: "Professional profile already exists",
      });
    }

    const business =
      await prisma.business.create({
        data: {
          ...result.data,
          ownerId,
        },

        include: {
          owner: {
            select: {
              id: true,
              name: true,
              role: true,
            },
          },
        },
      });

    return res.status(201).json(business);
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') {
      return res.status(409).json({ error: 'Ya tienes un perfil de negocio.' });
    }
    console.error(
      "Create business error:",
      error
    );

    return res.status(500).json({
      error: "Internal server error",
    });
  }
};

export const getBusinesses = async (
  _req: Request,
  res: Response
) => {
  try {
    const businesses = await prisma.business.findMany({
      where: { isArchived: false, owner: { isSuspended: false, role: 'PROFESSIONAL' } },
      include: {
        owner: {
          select: {
            id: true,
            name: true,
            ...bookingOwnerSelect,
          },
        },
      },

      orderBy: {
        createdAt: "desc",
      },
    });

    return res.status(200).json(businesses.map(({ owner, ...business }) => ({
      ...business, owner: { id: owner.id, name: owner.name, role: owner.role },
      canBook: canReceiveBookings({ ...business, owner }),
    })));
  } catch (error) {
    console.error("Get businesses error:", error);

    return res.status(500).json({
      error: "Internal server error",
    });
  }
};

export const getMyBusiness = async (
  req: Request,
  res: Response
) => {
  try {
    // La identidad viene de la sesión HttpOnly.
    // No aceptamos ownerId enviado desde Angular.
    const business =
      await prisma.business.findFirst({
        where: {
          ownerId: req.authUser!.id,
        },

        include: {
          services: {
            orderBy: {
              createdAt: "desc",
            },
          },

          availabilities: {
            orderBy: [
              {
                dayOfWeek: "asc",
              },
              {
                startTime: "asc",
              },
            ],
          },
        },
      });

    if (!business) {
      return res.status(404).json({
        error: "Professional profile not found",
      });
    }

    return res.status(200).json(business);
  } catch (error) {
    console.error(
      "Get my business error:",
      error
    );

    return res.status(500).json({
      error: "Internal server error",
    });
  }
};

export const getBusinessById = async (
  req: Request<{ id: string }>,
  res: Response
) => {
  try {
    const { id } = req.params;

    const business = await prisma.business.findUnique({
      where: {
        id,
      },

      include: {
        owner: {
          select: {
            id: true,
            name: true,
            ...bookingOwnerSelect,
          },
        },

        services: {
          where: {
            isActive: true,
          },
        },
      },
    });

    if (!business || business.isArchived || business.owner.isSuspended) {
      return res.status(404).json({
        error: "Business not found",
      });
    }

    const { owner, ...profile } = business;
    return res.status(200).json({
      ...profile, owner: { id: owner.id, name: owner.name, role: owner.role },
      canBook: canReceiveBookings(business),
    });
  } catch (error) {
    console.error("Get business error:", error);

    return res.status(500).json({
      error: "Internal server error",
    });
  }
};

export const updateBusinessAvatar = async (
  req: Request,
  res: Response
) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: "Image is required",
      });
    }

    if (req.file.size > 2 * 1024 * 1024) {
      return res.status(413).json({
        error: "Avatar must not exceed 2 MB",
      });
    }

    // El negocio se obtiene desde la sesión activa.
    // El navegador nunca decide qué businessId modificar.
    const business =
      await prisma.business.findFirst({
        where: {
          ownerId: req.authUser!.id,
        },
      });

    if (!business) {
      return res.status(404).json({
        error: "Professional profile not found",
      });
    }

    const uploaded =
      await uploadImageBuffer(
        req.file.buffer,
        {
          folder:
            `cronos/businesses/${business.id}/avatar`,

          public_id: randomUUID(),

          resource_type: "image",

          overwrite: true,
          invalidate: true,
        }
      );

    // Neon guarda únicamente la URL y el identificador.
    // El archivo real permanece almacenado en Cloudinary.
    const updatedBusiness =
      await prisma.business.update({
        where: {
          id: business.id,
        },

        data: {
          avatarUrl:
            uploaded.secure_url,

          avatarPublicId:
            uploaded.public_id,
        },
      });

    if (business.avatarPublicId && business.avatarPublicId !== uploaded.public_id) {
      await cloudinary.uploader.destroy(business.avatarPublicId, { invalidate: true }).catch(error => console.error("Old avatar cleanup failed:", error));
    }

    return res
      .status(200)
      .json(updatedBusiness);
  } catch (error) {
    console.error(
      "Update business avatar error:",
      error
    );

    return res.status(500).json({
      error: "Internal server error",
    });
  }
};

export const updateBusinessCover = async (
  req: Request,
  res: Response
) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        error: "Image is required",
      });
    }

    // La portada admite hasta 5 MB porque normalmente
    // utiliza una imagen horizontal de mayor resolución.
    if (req.file.size > 5 * 1024 * 1024) {
      return res.status(413).json({
        error: "Cover must not exceed 5 MB",
      });
    }

    const business =
      await prisma.business.findFirst({
        where: {
          ownerId: req.authUser!.id,
        },
      });

    if (!business) {
      return res.status(404).json({
        error: "Professional profile not found",
      });
    }

    const uploaded =
      await uploadImageBuffer(
        req.file.buffer,
        {
          folder:
            `cronos/businesses/${business.id}/cover`,

          public_id: randomUUID(),

          resource_type: "image",

          overwrite: true,
          invalidate: true,
        }
      );

    // Neon conserva únicamente la referencia de Cloudinary.
    // Subir una nueva portada reemplaza la anterior.
    const updatedBusiness =
      await prisma.business.update({
        where: {
          id: business.id,
        },

        data: {
          coverUrl: uploaded.secure_url,
          coverPublicId: uploaded.public_id,
        },
      });

    if (business.coverPublicId && business.coverPublicId !== uploaded.public_id) {
      await cloudinary.uploader.destroy(business.coverPublicId, { invalidate: true }).catch(error => console.error("Old cover cleanup failed:", error));
    }

    return res
      .status(200)
      .json(updatedBusiness);
  } catch (error) {
    console.error(
      "Update business cover error:",
      error
    );

    return res.status(500).json({
      error: "Internal server error",
    });
  }
};


export const updateMyBusiness = async (
  req: Request,
  res: Response
) => {
  const result = updateBusinessSchema.safeParse(req.body);

  if (!result.success) {
    return res.status(400).json({
      error: "Invalid request data",
      details: result.error.flatten(),
    });
  }

  try {
    // El negocio se obtiene desde el usuario autenticado.
    // Así el profesional no puede editar perfiles ajenos
    // manipulando un businessId desde el navegador.
    const business = await prisma.business.findFirst({
      where: {
        ownerId: req.authUser!.id,
      },
    });

    if (!business) {
      return res.status(404).json({
        error: "Professional profile not found",
      });
    }

    const updatedBusiness =
      await prisma.business.update({
        where: {
          id: business.id,
        },

        data: result.data,
      });

    return res.status(200).json(updatedBusiness);
  } catch (error) {
    console.error(
      "Update business error:",
      error
    );

    return res.status(500).json({
      error: "Internal server error",
    });
  }

  
};

const deleteBusinessImage = (kind: "avatar" | "cover") => async (req: Request, res: Response) => {
  const business = await prisma.business.findFirst({ where: { ownerId: req.authUser!.id } });
  if (!business) return res.status(404).json({ error: "Perfil profesional no encontrado." });
  const url = kind === "avatar" ? business.avatarUrl : business.coverUrl;
  const publicId = kind === "avatar" ? business.avatarPublicId : business.coverPublicId;
  // Compare the current image before clearing it so a concurrent replacement is preserved.
  const changed = await prisma.business.updateMany({
    where: {
      id: business.id, ownerId: req.authUser!.id,
      ...(kind === "avatar" ? { avatarUrl: url, avatarPublicId: publicId } : { coverUrl: url, coverPublicId: publicId }),
    },
    data: kind === "avatar" ? { avatarUrl: null, avatarPublicId: null } : { coverUrl: null, coverPublicId: null },
  });
  if (!changed.count) return res.status(409).json({ error: "La imagen cambió. Actualiza el perfil antes de eliminarla." });
  if (publicId) {
    // Removal from the profile succeeds even if Cloudinary cleanup needs a later retry.
    await cloudinary.uploader.destroy(publicId, { invalidate: true }).catch(error => console.error("Business image cleanup failed:", error));
  }
  return res.json(await prisma.business.findUniqueOrThrow({ where: { id: business.id } }));
};

export const deleteBusinessAvatar = deleteBusinessImage("avatar");
export const deleteBusinessCover = deleteBusinessImage("cover");
