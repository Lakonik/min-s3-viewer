# min-s3-viewer

Tiny local server that serves static HTML/CSS/JS/assets from a private S3 bucket using your local AWS credentials (no signed URLs needed).

### Setup
```bash
npm ci    # or: npm install
```

### Run
```bash
node server.js
```

### Usage

Open: `http://localhost:8787/<bucket>/<key...>`
