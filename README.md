# Google Drive Photo Downloader

Download photos recursively from Google Drive folders, including shared folders.

## Setup

### 1. Create Google Cloud Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project (or select an existing one)
3. Enable the **Google Drive API** (APIs & Services > Enable APIs)
4. Go to **Credentials > Create Credentials > OAuth client ID**
5. Select **Desktop app** as the application type
6. Download the JSON file and save it as `credentials.json` in this project's root directory

### 2. Install Dependencies

```bash
npm install
```

## Usage

```bash
node src/index.js <folder-url-or-id> [options]
```

The first run will open a browser for Google OAuth authentication. Subsequent runs use the cached token.

### Options

| Flag | Description |
|------|-------------|
| `--since, -s <time>` | Only include files modified after this time |
| `--list, -l` | List matching files without downloading |
| `-h, --help` | Show help |

### `--since` time formats

| Format | Example | Meaning |
|--------|---------|---------|
| Relative minutes | `30m` | Last 30 minutes |
| Relative hours | `2h` | Last 2 hours |
| Relative days | `1d` | Last 24 hours |
| Relative weeks | `1w` | Last 7 days |
| Relative months | `1M` | Last 30 days |
| ISO date | `2024-01-15` | Since Jan 15, 2024 |
| ISO datetime | `2024-01-15T10:30:00` | Since specific time |
| Unix timestamp | `1705312800` | Seconds since epoch |

### Examples

```bash
# Download all images from a folder
node src/index.js https://drive.google.com/drive/folders/ABC123

# Download using just the folder ID
node src/index.js ABC123

# List images modified in the last 24 hours (no download)
node src/index.js ABC123 --since 1d --list

# Download images modified since a specific date
node src/index.js ABC123 --since 2024-01-15

# Download images modified in the last 2 hours
node src/index.js ABC123 -s 2h
```

### Supported image formats

jpg, png, gif, webp, heic, heif, tiff, bmp, svg, ico

## Output

Images are downloaded to the `downloads/` directory, preserving the folder structure from Google Drive. Files that already exist locally are skipped.
