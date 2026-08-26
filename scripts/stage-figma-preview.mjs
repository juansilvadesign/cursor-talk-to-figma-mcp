#!/usr/bin/env node

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import fs from "node:fs/promises";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverPath = path.join(root, "dist/server.js");

const options = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const [key, ...rest] = arg.replace(/^--/, "").split("=");
    return [key, rest.join("=")];
  })
);

const channel = options.channel || "5nnnjalu";
const action = options.action || "inspect"; // "inspect" | "export"
const targetSlug = options.slug;
const nodeId = options["node-id"];
const outputDir = path.resolve(root, "../../../workspace/juansilva.design/projects/juansilva-design/public/assets/images");

const client = new Client({ name: "stage-figma-preview", version: "1.0.0" }, { capabilities: {} });
const transport = new StdioClientTransport({
  command: "bun",
  args: ["run", serverPath],
  cwd: root,
});

function parse(res) {
  if (!res || !res.content) return res;
  for (const c of res.content) {
    if (c.type === "text") {
      try {
        return JSON.parse(c.text);
      } catch (e) {
        return c.text;
      }
    }
  }
  return res;
}

async function main() {
  await client.connect(transport);
  await client.callTool({ name: "join_channel", arguments: { channel } });

  if (action === "inspect") {
    const doc = parse(await client.callTool({ name: "get_document_info", arguments: { summary: true } }));
    const pages = doc.pages || [];
    const report = {
      documentName: doc.name,
      pageCount: doc.pageCount,
      pages: []
    };

    for (const p of pages) {
      if (p.name.toLowerCase().includes("trash")) continue;
      try {
        await client.callTool({ name: "set_current_page", arguments: { pageId: p.id } });
        const pageInfo = parse(await client.callTool({
          name: "get_document_info",
          arguments: { summary: false, limit: 100, familyLimit: 100 }
        }));
        const candidateFrames = (pageInfo.children || [])
          .filter(c => c.type === "FRAME" || c.type === "COMPONENT" || c.type === "SECTION")
          .map(c => ({ id: c.id, name: c.name, type: c.type }));

        report.pages.push({
          id: p.id,
          name: p.name,
          frameCount: candidateFrames.length,
          frames: candidateFrames
        });
      } catch (err) {
        report.pages.push({ id: p.id, name: p.name, error: err.message });
      }
    }

    console.log(JSON.stringify(report, null, 2));
  } else if (action === "export") {
    if (!targetSlug || !nodeId) {
      console.error("Usage: --action=export --slug=<slug> --node-id=<nodeId>");
      process.exit(1);
    }

    const tmpPng = `/tmp/figma-export-${targetSlug}.png`;
    const targetWebp = path.join(outputDir, `${targetSlug}-preview.webp`);

    console.log(`Exporting node ${nodeId} for ${targetSlug}...`);
    const exportRes = parse(await client.callTool({
      name: "export_node_as_image",
      arguments: {
        nodeId,
        format: "PNG",
        scale: 1.5,
        filePath: tmpPng
      }
    }));

    console.log("Processing to 1920x1080 WebP...");
    execSync(`ffmpeg -y -i "${tmpPng}" -vf "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080" -c:v libwebp -quality 85 "${targetWebp}"`);

    const stat = await fs.stat(targetWebp);
    console.log(JSON.stringify({
      status: "success",
      slug: targetSlug,
      nodeId,
      path: targetWebp,
      sizeBytes: stat.size
    }, null, 2));
  }

  await client.close();
}

main().catch(err => {
  console.error("Error:", err);
  process.exit(1);
});
