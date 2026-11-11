import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { cloudinary } from "../lib/cloudinary.js";
import { uploadImageBuffer } from "../lib/cloudinary-upload.js";
import { attentionMetrics, localDay, monthEnvelope } from "../lib/attention-metrics.js";

const monthQuerySchema = z.object({ month: z.string().regex(/^[1-9]\d{3}-(0[1-9]|1[0-2])$/).optional() });
const querySchema = monthQuerySchema.extend({
  clientId: z.string().uuid().optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(50),
});
const notesSchema = z.object({ notes: z.string().trim().max(1500).nullable() });
const captionSchema = z.object({ caption: z.string().trim().max(300).optional() });
const idSchema = z.string().uuid();

export async function getSessions(req: Request, res: Response) {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Filtros de historial inválidos." });
  const { clientId, limit, month } = parsed.data;
  const period = month ? monthEnvelope(month) : undefined;
  let cursor = parsed.data.cursor;
  const matches = [];

  // Fill the page even when the UTC window includes records from neighboring local months.
  do {
    const sessions = await prisma.clientSession.findMany({
      where: {
        business: { ownerId: req.authUser!.id },
        clientId,
        ...(period ? { occurredAt: { gte: period.from, lt: period.until } } : {}),
      },
      include: {
        client: { select: { id: true, name: true, email: true } },
        business: { select: { id: true, name: true, timezone: true } },
        reservation: { include: { service: true } },
        evidences: { orderBy: { createdAt: "desc" } },
      },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    matches.push(...(month
      ? sessions.filter(session => localDay(session.occurredAt, session.business.timezone).slice(0, 7) === month)
      : sessions));
    cursor = sessions.length > limit ? sessions.at(-1)?.id : undefined;
  } while (cursor && matches.length <= limit);

  const items = matches.slice(0, limit);
  return res.json({ items, nextCursor: matches.length > limit ? items.at(-1)!.id : null });
}

export async function getAttentionMetrics(req: Request, res: Response) {
  const parsed = monthQuerySchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Mes inválido." });
  const business = await prisma.business.findFirst({ where: { ownerId: req.authUser!.id }, select: { id: true, timezone: true } });
  if (!business) return res.status(404).json({ error: "Negocio no encontrado." });
  const now = new Date();
  const month = parsed.data.month ?? localDay(now, business.timezone).slice(0, 7);
  const period = monthEnvelope(month);
  const sessions = await prisma.clientSession.findMany({
    where: { businessId: business.id, occurredAt: { gte: period.from, lt: period.until }, reservation: { status: "COMPLETED" } },
    select: { occurredAt: true, clientId: true, amount: true },
  });
  return res.json(attentionMetrics(sessions, now, business.timezone, month));
}

export async function updateSession(req: Request<{ id: string }>, res: Response) {
  const parsed = notesSchema.safeParse(req.body);
  if (!idSchema.safeParse(req.params.id).success || !parsed.success) return res.status(400).json({ error: "Nota o atención inválida." });
  const changed = await prisma.clientSession.updateMany({
    where: { id: req.params.id, business: { ownerId: req.authUser!.id } },
    data: { notes: parsed.data.notes || null },
  });
  if (!changed.count) return res.status(404).json({ error: "Atención no encontrada." });
  return res.json(await prisma.clientSession.findUniqueOrThrow({ where: { id: req.params.id } }));
}

export async function addEvidence(req: Request<{ id: string }>, res: Response) {
  const parsed = captionSchema.safeParse(req.body);
  if (!idSchema.safeParse(req.params.id).success || !parsed.success || !req.file) return res.status(400).json({ error: "Imagen o descripción inválida." });
  const session = await prisma.clientSession.findFirst({ where: { id: req.params.id, business: { ownerId: req.authUser!.id } } });
  if (!session) return res.status(404).json({ error: "Atención no encontrada." });
  const uploaded = await uploadImageBuffer(req.file.buffer, {
    folder: `cronos/businesses/${session.businessId}/sessions/${session.id}`,
    public_id: randomUUID(), resource_type: "image",
  });
  try {
    const evidence = await prisma.sessionEvidence.create({ data: {
      sessionId: session.id, imageUrl: uploaded.secure_url,
      imagePublicId: uploaded.public_id, caption: parsed.data.caption || null,
    } });
    return res.status(201).json(evidence);
  } catch (error) {
    await cloudinary.uploader.destroy(uploaded.public_id).catch(cleanupError => console.error("Evidence cleanup failed", cleanupError));
    throw error;
  }
}

export async function deleteEvidence(req: Request<{ id: string }>, res: Response) {
  if (!idSchema.safeParse(req.params.id).success) return res.status(400).json({ error: "Evidencia inválida." });
  const evidence = await prisma.sessionEvidence.findFirst({
    where: { id: req.params.id, session: { business: { ownerId: req.authUser!.id } } },
  });
  if (!evidence) return res.status(404).json({ error: "Evidencia no encontrada." });
  const result = await cloudinary.uploader.destroy(evidence.imagePublicId, { invalidate: true });
  if (!["ok", "not found"].includes(result.result)) throw new Error("Cloudinary deletion failed");
  await prisma.sessionEvidence.deleteMany({ where: { id: evidence.id } });
  return res.status(204).send();
}
