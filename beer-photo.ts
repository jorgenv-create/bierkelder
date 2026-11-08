import { maxPhotoLength, type Beer } from './beer';

export const beerPhotoUrl = (beer: Pick<Beer, 'id' | 'updatedAt'>) =>
  `/api/beers/${encodeURIComponent(beer.id)}/photo?v=${encodeURIComponent(beer.updatedAt)}`;

export function ownBeerPhoto(beer: Beer,guest=false) {
  if (beer.photo === null) return '';
  return beer.photo || (beer.hasPhoto ? (guest?beerPhotoUrl(beer).replace('/api/beers/','/api/public/beers/'):beerPhotoUrl(beer)) : '');
}

export function beerImages(beer: Beer,guest=false) {
  const own = ownBeerPhoto(beer,guest);
  return (beer.photoPreference === 'own' ? [own, beer.image] : [beer.image, own]).filter(Boolean);
}

export function photoDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(Error('De foto kon niet worden gelezen.'));
    reader.readAsDataURL(blob);
  });
}

export async function prepareBeerPhoto(file: File) {
  if (file.size > 25_000_000) throw Error('Kies een foto van maximaal 25 MB.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode().catch(() => { throw Error('Deze foto kan niet worden geopend. Kies een JPEG- of PNG-foto.'); });
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw Error('De foto kon niet worden voorbereid.');
    for (const maxSide of [1000, 750, 550]) {
      const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      const jpeg = canvas.toDataURL('image/jpeg', 0.78);
      if (jpeg.startsWith('data:image/jpeg;base64,') && jpeg.length <= maxPhotoLength) return jpeg;
    }
    throw Error('De foto kon niet klein genoeg worden gemaakt. Probeer een andere foto.');
  } finally {
    URL.revokeObjectURL(url);
  }
}
