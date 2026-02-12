import express from "express";
import { S3Client, GetObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import mime from "mime-types";

const app = express();
const port = process.env.PORT || 8787;

// Uses standard AWS credential chain (env, ~/.aws, AWS_PROFILE, SSO, etc.)
const s3 = new S3Client({ region: process.env.AWS_REGION });

function parseBucketAndKey(reqPath) {
  // "/my-bucket/a/b/c.png" -> bucket="my-bucket", key="a/b/c.png"
  const p = reqPath.replace(/^\/+/, "");
  const parts = p.split("/").filter(Boolean);
  if (parts.length < 2) return { bucket: null, key: null };
  const bucket = parts[0];
  const key = parts.slice(1).join("/");
  return { bucket, key };
}

app.get("/", (req, res) => {
  res
    .status(200)
    .send('Usage: /<bucket>/<key...>  e.g. /my-bucket/index.html');
});

app.get(/.*/, async (req, res) => {
  try {
    const { bucket, key } = parseBucketAndKey(req.path);
    if (!bucket || !key) {
      res.status(400).send("Bad path. Use /<bucket>/<key...>");
      return;
    }

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
      res.status(404).send("Not found");
      return;
    }
    console.error(err);
    res.status(500).send("Error fetching from S3");
  }
});

app.listen(port, () => {
  console.log(`Open: http://localhost:${port}/<bucket>/<key...>`);
});
