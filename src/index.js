#!/usr/bin/env node

import { authorize } from './auth.js';
import { downloadPhotos, extractFolderId } from './download.js';

/**
 * Parse --since value into a Date object
 * Supports: ISO dates, relative times (e.g., "1d", "2h", "30m"), timestamps
 */
function parseSince(value) {
  if (!value) return null;

  // Relative time (e.g., "1d", "2h", "30m", "1w")
  const relativeMatch = value.match(/^(\d+)([mhdwM])$/);
  if (relativeMatch) {
    const amount = parseInt(relativeMatch[1]);
    const unit = relativeMatch[2];
    const now = new Date();

    switch (unit) {
      case 'm': return new Date(now.getTime() - amount * 60 * 1000);
      case 'h': return new Date(now.getTime() - amount * 60 * 60 * 1000);
      case 'd': return new Date(now.getTime() - amount * 24 * 60 * 60 * 1000);
      case 'w': return new Date(now.getTime() - amount * 7 * 24 * 60 * 60 * 1000);
      case 'M': return new Date(now.getTime() - amount * 30 * 24 * 60 * 60 * 1000);
    }
  }

  // Unix timestamp (seconds)
  if (/^\d{10}$/.test(value)) {
    return new Date(parseInt(value) * 1000);
  }

  // Unix timestamp (milliseconds)
  if (/^\d{13}$/.test(value)) {
    return new Date(parseInt(value));
  }

  // Try parsing as date string
  const date = new Date(value);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date format: ${value}`);
  }

  return date;
}

/**
 * Parse command line arguments
 */
function parseArgs(args) {
  const options = {
    folderId: null,
    since: null,
    listOnly: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--since' || arg === '-s') {
      options.since = parseSince(args[++i]);
    } else if (arg === '--list' || arg === '-l') {
      options.listOnly = true;
    } else if (!arg.startsWith('-')) {
      options.folderId = arg;
    }
  }

  return options;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
Google Drive Photo Downloader

Usage:
  node src/index.js <folder-url-or-id> [options]
  npm start -- <folder-url-or-id> [options]

Options:
  --since, -s <time>   Only files modified after this time
                       Formats: ISO date, relative time, or timestamp
                       Examples: 2024-01-15, 1d, 2h, 30m, 1w, 1M
  --list, -l           List files only, don't download

Examples:
  # Download all images
  node src/index.js https://drive.google.com/drive/folders/ABC123

  # List images modified in the last 24 hours
  node src/index.js ABC123 --since 1d --list

  # Download images modified since a specific date
  node src/index.js ABC123 --since 2024-01-15

  # Download images modified in the last 2 hours
  node src/index.js ABC123 -s 2h

Setup:
  1. Go to https://console.cloud.google.com
  2. Create a project and enable Google Drive API
  3. Create OAuth 2.0 credentials (Desktop App)
  4. Download credentials and save as credentials.json in project root
  5. Run the script - it will open a browser for authentication

Downloaded images are saved to the downloads/ folder.
`);
    process.exit(0);
  }

  const options = parseArgs(args);

  if (!options.folderId) {
    console.error('Error: Folder URL or ID is required');
    process.exit(1);
  }

  try {
    const folderId = extractFolderId(options.folderId);
    console.log(`Folder ID: ${folderId}`);

    console.log('\nAuthenticating with Google Drive...');
    const authClient = await authorize();

    await downloadPhotos(authClient, folderId, {
      since: options.since,
      listOnly: options.listOnly,
    });
  } catch (error) {
    console.error('\nError:', error.message);
    process.exit(1);
  }
}

main();
