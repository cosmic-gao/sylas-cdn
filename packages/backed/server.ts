import { join, resolve, extname } from "path";
import { mkdirSync, existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { serve } from "bun";
import { createHash } from "crypto";

// 上传目录
const UPLOAD_DIR = resolve("../../buckets");
if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

// 生成文件 hash 名
function generateHashedFilename(originalName: string): string {
  const hash = createHash("sha256");
  hash.update(originalName + Date.now()); // 用文件名 + 时间戳生成唯一 hash
  const ext = extname(originalName); // 保留原文件扩展名
  return hash.digest("hex") + ext;
}

// 渲染文件列表
function renderFileList(): string {
  const files = readdirSync(UPLOAD_DIR);
  return `
    <h2>📁 文件服务器</h2>
    <ul>
      ${files.map(f => `<li><a href="/files/${encodeURIComponent(f)}">${f}</a></li>`).join("")}
    </ul>
    <hr/>
    <form method="POST" enctype="multipart/form-data">
      <input type="file" name="file" />
      <button type="submit">上传</button>
    </form>
  `;
}

// 读取文件
function getFileContent(filename: string) {
  const filePath = join(UPLOAD_DIR, filename);
  if (!existsSync(filePath)) return null;
  return readFileSync(filePath);
}

// 上传文件
async function handleFileUpload(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return new Response("❌ 未选择文件", { status: 400 });

    const arrayBuffer = await file.arrayBuffer();
    const hashedName = generateHashedFilename(file.name);
    const filePath = join(UPLOAD_DIR, hashedName);
    writeFileSync(filePath, Buffer.from(arrayBuffer));

    return new Response(
      `<p>✅ 文件上传成功！新文件名：${hashedName}</p><a href="/">返回</a>`,
      { headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  } catch (err) {
    return new Response(`❌ 上传失败: ${err}`, { status: 500 });
  }
}

// 启动服务器
serve({
  port: 3000,
  async fetch(req: Request) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method === "GET" && path === "/") {
      return new Response(renderFileList(), { headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    if (req.method === "GET" && path.startsWith("/files/")) {
      const filename = decodeURIComponent(path.replace("/files/", ""));
      const content = getFileContent(filename);
      if (!content) return new Response("❌ 文件不存在", { status: 404 });
      return new Response(content);
    }

    if (req.method === "POST") {
      return handleFileUpload(req);
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log("🚀 文件服务器运行中: http://localhost:3000");
