import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const client = new Client({ name: "export-celus", version: "1.0.0" }, { capabilities: {} });
const transport = new StdioClientTransport({
  command: "bun",
  args: ["run", path.join(root, "dist/server.js")],
  cwd: root,
});

const assetsDir = "/home/jaypy/GitHub-Projects/Notes/ai-synthesizer/workspace/juansilva.design/projects/juansilva-design/motion/celus-showcase/assets";

const items = [
  { name: "clinician-home.png", id: "19011:74", scale: 2.0 },
  { name: "medultra-list.png", id: "19120:12315", scale: 2.5 },
  { name: "calculus-step1.png", id: "19130:18798", scale: 2.5 },
  { name: "calculus-step2.png", id: "19141:10470", scale: 2.5 },
  { name: "calculus-step3.png", id: "19141:10704", scale: 2.5 },
  { name: "calculus-step4.png", id: "19141:11021", scale: 2.5 },
  { name: "calculus-step5.png", id: "19142:10813", scale: 2.5 },
  { name: "calculus-result.png", id: "19144:10950", scale: 2.5 },
  { name: "laudus-list.png", id: "19109:43745", scale: 2.5 },
  { name: "protocolus-list.png", id: "19109:43735", scale: 2.5 },
  { name: "protocolus-detail.png", id: "19200:35440", scale: 2.0 },
  { name: "admin-dashboard.png", id: "19106:23307", scale: 1.5 },
  { name: "admin-laudus-cms.png", id: "19109:28732", scale: 1.5 },
  { name: "admin-protocolus-cms.png", id: "19109:33468", scale: 1.5 },
  { name: "admin-analytics.png", id: "19109:44901", scale: 1.5 },
  { name: "admin-users.png", id: "19106:32989", scale: 1.5 },
  { name: "celus-logo.png", id: "20040:576", scale: 3.0 },
];

await client.connect(transport);
await client.callTool({ name: "join_channel", arguments: { channel: "5b329g11" } });

for (const item of items) {
  const filePath = path.join(assetsDir, item.name);
  console.log(`Exporting ${item.name} (id: ${item.id}, scale: ${item.scale})...`);
  try {
    await client.callTool({
      name: "export_node_as_image",
      arguments: {
        nodeId: item.id,
        format: "PNG",
        scale: item.scale,
        allowLargeExport: true,
        filePath,
      }
    });
  } catch (err) {
    // ignore harmless resultSchema.parse error if file was written
  }
  try {
    const stat = await fs.stat(filePath);
    console.log(`  ✓ ${item.name} saved (${Math.round(stat.size / 1024)} KB)`);
  } catch (err) {
    console.error(`  ✗ ${item.name} was not created:`, err.message);
  }
}

await client.close();
console.log("All Figma exports finished!");
