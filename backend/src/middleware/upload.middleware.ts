import multer from "multer";
import type { RequestHandler } from "express";

const allowedMimeTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

function matchesImageType(file: Express.Multer.File): boolean {
  const { buffer, mimetype } = file;
  if (mimetype === "image/jpeg") return buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  if (mimetype === "image/png") return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
}

const imageUpload = multer({
  storage: multer.memoryStorage(),

  limits: {
    fileSize: 5 * 1024 * 1024,
  },

  fileFilter: (_req, file, callback) => {
    if (!allowedMimeTypes.includes(file.mimetype)) {
      callback(
        new Error(
          "Elige una imagen JPEG, PNG o WebP."
        )
      );

      return;
    }

    callback(null, true);
  },
});

// La imagen se mantiene temporalmente en memoria.
// También devolvemos errores JSON claros antes del controller.
export const uploadBusinessImage: RequestHandler = (
  req,
  res,
  next
) => {
  imageUpload.single("image")(
    req,
    res,
    (error) => {
      if (!error) {
        if (req.file && !matchesImageType(req.file)) {
          res.status(400).json({ error: "El archivo debe ser una imagen JPEG, PNG o WebP válida." });
          return;
        }
        next();
        return;
      }

      if (
        error instanceof multer.MulterError &&
        error.code === "LIMIT_FILE_SIZE"
      ) {
        res.status(413).json({
          error: "La imagen debe pesar como máximo 5 MB.",
        });

        return;
      }

      res.status(400).json({
        error:
          error instanceof Error
            ? error.message
            : "Elige una imagen válida.",
      });
    }
  );
};
