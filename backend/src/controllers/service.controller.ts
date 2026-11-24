import type { Request, Response } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { serviceFields } from "../lib/input-validation.js";

const createServiceSchema = z.object({
  businessId: z.string().uuid(),
  ...serviceFields,
});

export const createService = async (
  req: Request,
  res: Response
) => {
  const result = createServiceSchema.safeParse(req.body);

  if (!result.success) {
    return res.status(400).json({
      error: "Invalid request data",
      details: result.error.flatten(),
    });
  }

  const {
    businessId,
    name,
    description,
    durationMin,
    price,
    isActive,
  } = result.data;

  try {
    const business = await prisma.business.findFirst({
      where: {
        id: businessId,
        ownerId: req.authUser!.id,
      },
    });

    if (!business) {
      return res.status(403).json({
        error: "You do not own this business",
      });
    }

    const service = await prisma.service.create({
      data: {
        businessId,
        name,
        description,
        durationMin,
        price,
        isActive,
      },
    });

    return res.status(201).json(service);
  } catch (error) {
    console.error("Create service error:", error);

    return res.status(500).json({
      error: "Internal server error",
    });
  }
};

export const getServices = async (req: Request, res: Response) => {
  try {
    const businessId =
      typeof req.query.businessId === "string"
        ? req.query.businessId
        : undefined;

    const services = await prisma.service.findMany({
      where: businessId ? { businessId } : undefined,
      include: {
        business: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return res.status(200).json(services);
  } catch (error) {
    console.error("Get services error:", error);

    return res.status(500).json({
      error: "Internal server error",
    });
  }
};

export const getServiceById = async (
  req: Request<{ id: string }>,
  res: Response
) => {
  try {
    const { id } = req.params;

    const service = await prisma.service.findUnique({
      where: { id },
      include: {
        business: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!service) {
      return res.status(404).json({
        error: "Service not found",
      });
    }

    return res.status(200).json(service);
  } catch (error) {
    console.error("Get service error:", error);

    return res.status(500).json({
      error: "Internal server error",
    });
  }
};



const updateServiceSchema = z
  .object(serviceFields).partial()
  .refine((data) => Object.keys(data).length > 0, {
    message: "At least one field is required",
  });

export const updateService = async (
  req: Request<{ id: string }>,
  res: Response
) => {
  const result = updateServiceSchema.safeParse(req.body);

  if (!result.success) {
    return res.status(400).json({
      error: "Invalid request data",
      details: result.error.flatten(),
    });
  }

  try {
    const service = await prisma.service.findUnique({
      where: {
        id: req.params.id,
      },

      include: {
        business: true,
      },
    });

    if (!service) {
      return res.status(404).json({
        error: "Service not found",
      });
    }

    if (
      service.business.ownerId !==
      req.authUser!.id
    ) {
      return res.status(403).json({
        error: "Forbidden",
      });
    }

    const updatedService = await prisma.service.update({
      where: {
        id: req.params.id,
      },

      data: result.data,
    });

    return res.status(200).json(updatedService);
  } catch (error) {
    console.error("Update service error:", error);

    return res.status(500).json({
      error: "Internal server error",
    });
  }
};
