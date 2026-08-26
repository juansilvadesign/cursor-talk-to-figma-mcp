import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import fs from "node:fs/promises";

const root = "/home/jaypy/GitHub-Projects/Notes/ai-synthesizer/knowledge/projects/talk-to-figma-fork";
const serverPath = path.join(root, "dist/server.js");
const client = new Client({ name: "audit-client", version: "1.0.0" }, { capabilities: {} });
const transport = new StdioClientTransport({
  command: "bun",
  args: ["run", serverPath],
  cwd: root,
});

async function main() {
  await client.connect(transport);
  console.log("Connected to MCP server. Joining channel 28e2fym3...");
  const joinRes = await client.callTool({
    name: "join_channel",
    arguments: { channel: "28e2fym3" }
  });
  console.log("Join result:", JSON.stringify(joinRes, null, 2));

  console.log("Getting document info with pages...");
  const docInfo = await client.callTool({
    name: "get_document_info",
    arguments: { includePages: true }
  });

  // Inspect page Design (1:2)
  console.log("Getting node info for Design page 1:2...");
  const designPage = await client.callTool({
    name: "get_node_info",
    arguments: { nodeId: "1:2", depth: 2 }
  });
  
  // Inspect page Style Guide (1:3)
  console.log("Getting node info for Style Guide page 1:3...");
  const styleGuidePage = await client.callTool({
    name: "get_node_info",
    arguments: { nodeId: "1:3", depth: 2 }
  });

  // Inspect page Trash (1:4)
  console.log("Getting node info for Trash page 1:4...");
  const trashPage = await client.callTool({
    name: "get_node_info",
    arguments: { nodeId: "1:4", depth: 2 }
  });

  // Inspect styles
  console.log("Getting styles...");
  let styles = null;
  try {
    styles = await client.callTool({
      name: "get_styles",
      arguments: {}
    });
  } catch (e) {
    console.error("get_styles error:", e.message);
  }

  const output = {
    docInfo,
    designPage,
    styleGuidePage,
    trashPage,
    styles
  };

  await fs.writeFile("/tmp/listbox-audit.json", JSON.stringify(output, null, 2));
  console.log("Audit saved to /tmp/listbox-audit.json");
  process.exit(0);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
