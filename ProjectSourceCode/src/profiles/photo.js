const multer = require('multer');
const sharp = require('sharp');

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const PHOTO_ERROR = 'Choose a valid JPG, PNG, or WebP photo up to 5 MB.';
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PHOTO_BYTES, files: 1, fields: 5, parts: 8, fieldSize: 4096 },
  fileFilter(req, file, callback) {
    callback(PHOTO_TYPES.has(file.mimetype) ? null : new Error(PHOTO_ERROR), true);
  },
}).single('avatar_photo');

function receiveProfilePhoto(req, res, next) {
  upload(req, res, error => {
    if (error) req.photoUploadError = PHOTO_ERROR;
    next();
  });
}

async function encodeProfilePhoto(file) {
  try {
    const image = sharp(file.buffer, { limitInputPixels: 40_000_000, failOn: 'warning' });
    const metadata = await image.metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format)) throw new Error(PHOTO_ERROR);
    // Re-encode and strip metadata; keep the small avatar in the existing database
    // column so photos survive container restarts without a separate upload volume.
    const photo = await image.rotate().resize(512, 512, { fit: 'cover', withoutEnlargement: true })
      .flatten({ background: '#ffffff' }).jpeg({ quality: 85 }).toBuffer();
    return `data:image/jpeg;base64,${photo.toString('base64')}`;
  } catch {
    throw new Error(PHOTO_ERROR);
  }
}

function profilePhotoFields(profileUser) {
  return { avatarInputUrl: profileUser.avatar_url?.startsWith('https:') ? profileUser.avatar_url : '' };
}

module.exports = { receiveProfilePhoto, encodeProfilePhoto, profilePhotoFields };
