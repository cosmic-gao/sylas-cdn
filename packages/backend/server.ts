import { join, resolve, extname, basename } from "path";
import { mkdirSync, existsSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { serve } from "bun";
import { createHash } from "crypto";

const UPLOAD_DIR = resolve("../../buckets");
if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

// 生成 hash 文件名
function generateHashFilename(originalName: string, content: Buffer): string {
  const ext = extname(originalName);
  const nameWithoutExt = basename(originalName, ext);
  const hash = createHash("sha256").update(content).digest("hex").slice(0, 12);
  return `${nameWithoutExt}-${hash}${ext}`;
}

// 删除同名旧文件
function removeOldFiles(originalName: string) {
  const ext = extname(originalName);
  const nameWithoutExt = basename(originalName, ext);
  const files = readdirSync(UPLOAD_DIR);
  files.forEach(f => {
    if (f.startsWith(nameWithoutExt + "-") && f.endsWith(ext)) {
      unlinkSync(join(UPLOAD_DIR, f));
    }
  });
}

// 上传文件
async function handleFileUpload(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return new Response("❌ 未选择文件", { status: 400 });

    const buffer = Buffer.from(await file.arrayBuffer());

    // 删除旧版本
    removeOldFiles(file.name);

    const hashedName = generateHashFilename(file.name, buffer);
    writeFileSync(join(UPLOAD_DIR, hashedName), buffer);

    return new Response(
      `<p>✅ 文件上传成功！新文件名：<a href="/files/${hashedName}">${hashedName}</a></p><a href="/">返回</a>`,
      { headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  } catch (err) {
    return new Response(`❌ 上传失败: ${err}`, { status: 500 });
  }
}

// 删除文件
async function handleFileDelete(req: Request) {
  try {
    const formData = await req.formData();
    const filename = formData.get("filename") as string;
    if (!filename) return new Response("❌ 未指定文件名", { status: 400 });

    const filePath = join(UPLOAD_DIR, filename);
    if (!existsSync(filePath)) return new Response("❌ 文件不存在", { status: 404 });

    unlinkSync(filePath);
    return new Response(`<p>✅ 文件已删除: ${filename}</p><a href="/">返回</a>`, {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  } catch (err) {
    return new Response(`❌ 删除失败: ${err}`, { status: 500 });
  }
}

// 获取文件列表
function getFileList() {
  return readdirSync(UPLOAD_DIR).map(f => ({ filename: f, url: `/files/${encodeURIComponent(f)}` }));
}

// 渲染 HTML
function renderFileList(): string {
  const files = getFileList();
  return `
    <h2>📁 CDN 文件服务器</h2>
    <ul>
      ${files
        .map(
          f => `<li>
                  <a href="${f.url}">${f.filename}</a>
                  <form method="POST" action="/delete" style="display:inline">
                    <input type="hidden" name="filename" value="${f.filename}" />
                    <button type="submit">删除</button>
                  </form>
                 </li>`
        )
        .join("")}
    </ul>
    <hr/>
    <form method="POST" enctype="multipart/form-data">
      <input type="file" name="file" />
      <button type="submit">上传 / 替换文件</button>
    </form>
  `;
}

// 读取文件内容
function getFileContent(filename: string) {
  const path = join(UPLOAD_DIR, filename);
  if (!existsSync(path)) return null;
  return readFileSync(path);
}

// 启动服务器
serve({
  port: 3000,
  async fetch(req: Request) {
    const url = new URL(req.url);
    const path = url.pathname;

    if (req.method === "GET" && path === "/") return new Response(renderFileList(), { headers: { "Content-Type": "text/html; charset=utf-8" } });

    if (req.method === "GET" && path.startsWith("/files/")) {
      const filename = decodeURIComponent(path.replace("/files/", ""));
      const content = getFileContent(filename);
      if (!content) return new Response("❌ 文件不存在", { status: 404 });
      return new Response(content);
    }

    if (req.method === "POST") {
      if (path === "/delete") return handleFileDelete(req);
      else return handleFileUpload(req);
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log("🚀 CDN 文件服务器运行中: http://localhost:3000");
