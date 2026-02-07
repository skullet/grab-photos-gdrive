import { google } from 'googleapis';
import { createWriteStream, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT_DIR = join(__dirname, '..');
const DOWNLOADS_DIR = join(ROOT_DIR, 'downloads');

// Image MIME types to download
const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/tiff',
  'image/bmp',
  'image/svg+xml',
  'image/x-icon',
]);

// Google Photos export MIME types (for Google Photos stored in Drive)
const GOOGLE_PHOTO_MIME_TYPE = 'application/vnd.google-apps.photo';

/**
 * Extract folder ID from Google Drive URL or return as-is if already an ID
 */
export function extractFolderId(input) {
  // Already a folder ID (no slashes, alphanumeric with dashes/underscores)
  if (/^[\w-]+$/.test(input) && !input.includes('/')) {
    return input;
  }

  // URL patterns:
  // https://drive.google.com/drive/folders/FOLDER_ID
  // https://drive.google.com/drive/folders/FOLDER_ID?usp=sharing
  // https://drive.google.com/drive/u/0/folders/FOLDER_ID
  const folderMatch = input.match(/\/folders\/([^/?]+)/);
  if (folderMatch) {
    return folderMatch[1];
  }

  throw new Error(`Could not extract folder ID from: ${input}`);
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry with exponential backoff
 */
async function withRetry(fn, maxRetries = 5) {
  let lastError;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      // Check if it's a rate limit error
      if (error.code === 429 || error.code === 403) {
        const delay = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
        console.log(`Rate limited. Retrying in ${Math.round(delay / 1000)}s...`);
        await sleep(delay);
      } else {
        throw error;
      }
    }
  }

  throw lastError;
}

/**
 * List all files in a folder
 */
async function listFilesInFolder(drive, folderId, options = {}, pageToken = null) {
  const { since } = options;

  // Always include folders so we can recurse into them
  // Only apply time filter to non-folder files
  let query = `'${folderId}' in parents and trashed = false`;
  if (since) {
    query += ` and (mimeType = 'application/vnd.google-apps.folder' or modifiedTime > '${since.toISOString()}')`;
  }

  const response = await withRetry(() =>
    drive.files.list({
      q: query,
      fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime)',
      pageSize: 100,
      pageToken,
    })
  );

  const files = response.data.files || [];
  const nextPageToken = response.data.nextPageToken;

  if (nextPageToken) {
    const moreFiles = await listFilesInFolder(drive, folderId, options, nextPageToken);
    return [...files, ...moreFiles];
  }

  return files;
}

/**
 * Recursively get all images from a folder
 */
async function getImagesRecursive(drive, folderId, options = {}, currentPath = '') {
  const files = await listFilesInFolder(drive, folderId, options);
  const images = [];

  for (const file of files) {
    const filePath = currentPath ? `${currentPath}/${file.name}` : file.name;

    if (file.mimeType === 'application/vnd.google-apps.folder') {
      // Recurse into subfolders (folders don't have modifiedTime filter applied to contents)
      console.log(`Scanning folder: ${filePath}`);
      const subImages = await getImagesRecursive(drive, file.id, options, filePath);
      images.push(...subImages);
    } else if (IMAGE_MIME_TYPES.has(file.mimeType) || file.mimeType === GOOGLE_PHOTO_MIME_TYPE) {
      images.push({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        size: file.size,
        modifiedTime: file.modifiedTime,
        path: filePath,
      });
    }
  }

  return images;
}

/**
 * Download a single file
 */
async function downloadFile(drive, fileId, destPath) {
  // Ensure directory exists
  const dir = dirname(destPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Skip if already downloaded
  if (existsSync(destPath)) {
    return false;
  }

  const response = await withRetry(() =>
    drive.files.get(
      { fileId, alt: 'media' },
      { responseType: 'stream' }
    )
  );

  return new Promise((resolve, reject) => {
    const dest = createWriteStream(destPath);
    response.data
      .on('error', reject)
      .pipe(dest)
      .on('error', reject)
      .on('finish', () => resolve(true));
  });
}

/**
 * Format file size for display
 */
function formatSize(bytes) {
  if (!bytes) return 'unknown size';
  const units = ['B', 'KB', 'MB', 'GB'];
  let size = parseInt(bytes);
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * Format date for display
 */
function formatDate(isoString) {
  return new Date(isoString).toLocaleString();
}

/**
 * Download all photos from a Google Drive folder
 */
export async function downloadPhotos(authClient, folderId, options = {}) {
  const { outputDir = DOWNLOADS_DIR, since, listOnly = false } = options;

  const drive = google.drive({ version: 'v3', auth: authClient });

  if (since) {
    console.log(`\nScanning for images modified after ${formatDate(since.toISOString())}...\n`);
  } else {
    console.log('\nScanning for images...\n');
  }

  const images = await getImagesRecursive(drive, folderId, { since });

  if (images.length === 0) {
    console.log('No images found in the folder.');
    return { downloaded: 0, skipped: 0, failed: 0, listed: 0 };
  }

  // List-only mode: just show files without downloading
  if (listOnly) {
    console.log(`\nFound ${images.length} images:\n`);
    for (const image of images) {
      const modified = image.modifiedTime ? formatDate(image.modifiedTime) : 'unknown';
      console.log(`  ${image.path}`);
      console.log(`    Modified: ${modified} | Size: ${formatSize(image.size)}`);
    }
    return { downloaded: 0, skipped: 0, failed: 0, listed: images.length };
  }

  console.log(`\nFound ${images.length} images. Starting download...\n`);

  let downloaded = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < images.length; i++) {
    const image = images[i];
    const destPath = join(outputDir, image.path);
    const progress = `[${i + 1}/${images.length}]`;

    try {
      const wasDownloaded = await downloadFile(drive, image.id, destPath);

      if (wasDownloaded) {
        console.log(`${progress} Downloaded: ${image.path} (${formatSize(image.size)})`);
        downloaded++;
      } else {
        console.log(`${progress} Skipped (exists): ${image.path}`);
        skipped++;
      }
    } catch (error) {
      console.error(`${progress} Failed: ${image.path} - ${error.message}`);
      failed++;
    }

    // Small delay to avoid rate limiting
    if (i < images.length - 1) {
      await sleep(100);
    }
  }

  console.log(`\nDownload complete!`);
  console.log(`  Downloaded: ${downloaded}`);
  console.log(`  Skipped: ${skipped}`);
  console.log(`  Failed: ${failed}`);

  return { downloaded, skipped, failed };
}
