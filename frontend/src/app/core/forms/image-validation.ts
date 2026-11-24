export function imageError(file: File, maxMb: number): string {
  if (!file.size || file.size > maxMb * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    return `Elige una imagen JPEG, PNG o WebP de hasta ${maxMb} MB.`;
  }
  return '';
}
