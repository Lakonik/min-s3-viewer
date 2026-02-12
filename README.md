# min-s3-viewer

A minimal local web server for browsing and viewing S3 buckets and files using your local AWS credentials.

## Features

- Browse all your S3 buckets across regions and navigate directory hierarchies
- View files directly in the browser (HTML, images, etc.)
- Works with private buckets using your local AWS credentials (environment variables, AWS SSO, etc.), no signed URLs needed

## Setup

```bash
npm ci    # or: npm install
```

## Usage

```bash
node server.js
```

Then open http://localhost:8787 to start browsing your S3 buckets.
