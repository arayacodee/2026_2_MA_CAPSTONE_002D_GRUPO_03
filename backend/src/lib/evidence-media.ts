import { cloudinary } from './cloudinary.js';

export function evidenceForRead<T extends { imagePublicId: string; deliveryType: string }>(evidence: T) {
  return {
    ...evidence,
    imageUrl: evidence.deliveryType === 'authenticated'
      ? cloudinary.utils.private_download_url(evidence.imagePublicId, '', {
        type: 'authenticated',
        resource_type: 'image',
        expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
      })
      : null,
  };
}
