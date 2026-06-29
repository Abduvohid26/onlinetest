/** Backend PROFILE_IMAGE_MAX_B64 dan biroz kichikroq — xavfsiz zaxira. */
const MAX_B64_LEN = 1_800_000;
const MAX_SIDE = 1024;

export class ProfileImageError extends Error {
  constructor(readonly code: 'too_large' | 'invalid') {
    super(code);
  }
}

function resizeImageFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      let { width, height } = img;
      const max = MAX_SIDE;
      if (width > max || height > max) {
        if (width >= height) {
          height = Math.round((height * max) / width);
          width = max;
        } else {
          width = Math.round((width * max) / height);
          height = max;
        }
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new ProfileImageError('invalid'));
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      let quality = 0.88;
      let result = canvas.toDataURL('image/jpeg', quality);
      while (result.length > MAX_B64_LEN && quality > 0.35) {
        quality -= 0.08;
        result = canvas.toDataURL('image/jpeg', quality);
      }
      if (result.length > MAX_B64_LEN) {
        reject(new ProfileImageError('too_large'));
      } else {
        resolve(result);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new ProfileImageError('invalid'));
    };
    img.src = url;
  });
}

export async function fileToProfileImageBase64(file: File): Promise<string> {
  if (!file.type.startsWith('image/') || file.size < 1) {
    throw new ProfileImageError('invalid');
  }
  return resizeImageFile(file);
}
