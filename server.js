import express from "express";
import { S3Client, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, ListBucketsCommand } from "@aws-sdk/client-s3";
import mime from "mime-types";

const app = express();
const port = process.env.PORT || 8787;

// Uses standard AWS credential chain (env, ~/.aws, AWS_PROFILE, SSO, etc.)
const s3 = new S3Client({ region: process.env.AWS_REGION });

function parseBucketAndKey(reqPath) {
  // "/my-bucket/a/b/c.png" -> bucket="my-bucket", key="a/b/c.png"
  const p = reqPath.replace(/^\/+/, "");
  const parts = p.split("/").filter(Boolean);
  if (parts.length < 1) return { bucket: null, key: null };
  const bucket = parts[0];
  const key = parts.slice(1).join("/");
  return { bucket, key };
}

async function listS3Objects(bucket, prefix) {
  const result = await s3.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      Delimiter: "/",
    })
  );
  return {
    folders: result.CommonPrefixes || [],
    files: result.Contents || [],
  };
}

function generateIndexHtml(bucket, prefix, folders, files, reqPath) {
  const breadcrumbs = [];
  const pathParts = prefix ? prefix.split("/").filter(Boolean) : [];
  let currentPath = `/${bucket}`;
  breadcrumbs.push(`<a href="${currentPath}">${bucket}</a>`);

  for (const part of pathParts) {
    currentPath += `/${part}`;
    breadcrumbs.push(`<a href="${currentPath}">${part}</a>`);
  }

  const rows = [];

  // Parent directory link
  if (prefix) {
    const parentPath = reqPath.replace(/\/$/, "").split("/").slice(0, -1).join("/") || `/${bucket}`;
    rows.push(`<tr><td><a href="${parentPath}">📁 ..</a></td><td>-</td></tr>`);
  }

  // Folders
  for (const folder of folders) {
    const folderName = folder.Prefix.slice(prefix.length).replace(/\/$/, "");
    const folderPath = `/${bucket}/${folder.Prefix}`;
    rows.push(`<tr><td><a href="${folderPath}">📁 ${folderName}/</a></td><td>-</td></tr>`);
  }

  // Files
  for (const file of files) {
    const fileName = file.Key.slice(prefix.length);
    if (!fileName) continue; // Skip the prefix itself
    const filePath = `/${bucket}/${file.Key}`;
    const size = formatBytes(file.Size);
    rows.push(`<tr><td><a href="${filePath}">📄 ${fileName}</a></td><td>${size}</td></tr>`);
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Index of ${reqPath}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; margin: 2rem; }
    h1 { font-size: 1.5rem; margin-bottom: 0.5rem; }
    .breadcrumbs { color: #666; margin-bottom: 1.5rem; }
    .breadcrumbs a { color: #0066cc; text-decoration: none; }
    .breadcrumbs a:hover { text-decoration: underline; }
    table { border-collapse: collapse; width: 100%; max-width: 900px; }
    th { text-align: left; padding: 0.5rem; border-bottom: 2px solid #ddd; background: #f5f5f5; }
    td { padding: 0.5rem; border-bottom: 1px solid #eee; }
    td:first-child { width: 70%; }
    td:last-child { text-align: right; color: #666; }
    a { color: #0066cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>Index of ${reqPath}</h1>
  <div class="breadcrumbs">${breadcrumbs.join(" / ")}</div>
  <table>
    <thead>
      <tr><th>Name</th><th>Size</th></tr>
    </thead>
    <tbody>
      ${rows.join("\n      ")}
    </tbody>
  </table>
</body>
</html>`;
}

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + " " + sizes[i];
}

app.get("/", async (req, res) => {
  try {
    const result = await s3.send(new ListBucketsCommand({}));
    const buckets = result.Buckets || [];

    const rows = buckets.map(bucket => {
      const bucketPath = `/${bucket.Name}`;
      const creationDate = bucket.CreationDate ? bucket.CreationDate.toISOString().split('T')[0] : '-';
      return `<tr><td><a href="${bucketPath}">📦 ${bucket.Name}</a></td><td>${creationDate}</td></tr>`;
    }).join("\n      ");

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>S3 Buckets</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; margin: 2rem; }
    h1 { font-size: 1.5rem; margin-bottom: 1.5rem; }
    table { border-collapse: collapse; width: 100%; max-width: 900px; }
    th { text-align: left; padding: 0.5rem; border-bottom: 2px solid #ddd; background: #f5f5f5; }
    td { padding: 0.5rem; border-bottom: 1px solid #eee; }
    td:first-child { width: 70%; }
    td:last-child { text-align: right; color: #666; }
    a { color: #0066cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>S3 Buckets</h1>
  <table>
    <thead>
      <tr><th>Name</th><th>Created</th></tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
</body>
</html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (err) {
    console.error(err);
    res.status(500).send("Error listing buckets");
  }
});

app.get(/.*/, async (req, res) => {
  try {
    const { bucket, key } = parseBucketAndKey(req.path);
    if (!bucket) {
      res.status(400).send("Bad path. Use /<bucket>/<key...>");
      return;
    }

    // If no key or key ends with /, treat as directory
    if (!key || key.endsWith("/")) {
      const prefix = key || "";
      const { folders, files } = await listS3Objects(bucket, prefix);
      const html = generateIndexHtml(bucket, prefix, folders, files, req.path);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.send(html);
      return;
    }

    // Try to fetch as file first
    try {
      const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      const contentType =
        head.ContentType ||
        mime.lookup(key) ||
        "application/octet-stream";

      res.setHeader("Content-Type", contentType);
      if (head.CacheControl) res.setHeader("Cache-Control", head.CacheControl);
      if (head.ETag) res.setHeader("ETag", head.ETag);

      const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      obj.Body.pipe(res);
    } catch (err) {
      const status = err?.$metadata?.httpStatusCode;
      if (status === 404 || err?.name === "NotFound" || err?.name === "NoSuchKey") {
        // File not found, try as directory
        const prefix = key.endsWith("/") ? key : key + "/";
        const { folders, files } = await listS3Objects(bucket, prefix);

        if (folders.length > 0 || files.length > 0) {
          const html = generateIndexHtml(bucket, prefix, folders, files, req.path.endsWith("/") ? req.path : req.path + "/");
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.send(html);
        } else {
          res.status(404).send("Not found");
        }
        return;
      }
      throw err;
    }
  } catch (err) {
    console.error(err);
    res.status(500).send("Error fetching from S3");
  }
});

app.listen(port, () => {
  console.log(`Open: http://localhost:${port}/<bucket>/<key...>`);
});
