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

function parseContent(res) {
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
  console.log("Connected. Joining channel 28e2fym3...");
  const joinRes = await client.callTool({
    name: "join_channel",
    arguments: { channel: "28e2fym3" }
  });
  console.log("Joined:", joinRes);

  const runtimeInfo = parseContent(await client.callTool({
    name: "get_runtime_info",
    arguments: {}
  }));

  const initialDoc = parseContent(await client.callTool({
    name: "get_document_info",
    arguments: { summary: true }
  }));

  const pagesInfo = [];

  for (const page of initialDoc.pages || []) {
    console.log(`Switching to page: ${page.name} (${page.id})...`);
    await client.callTool({
      name: "set_current_page",
      arguments: { pageId: page.id }
    });

    const pageDoc = parseContent(await client.callTool({
      name: "get_document_info",
      arguments: { summary: true, limit: 100 }
    }));

    pagesInfo.push({
      id: page.id,
      name: page.name,
      doc: pageDoc
    });
  }

  // Restore Cover page
  if (initialDoc.pages && initialDoc.pages.length > 0) {
    await client.callTool({
      name: "set_current_page",
      arguments: { pageId: initialDoc.pages[0].id }
    });
  }

  let styles = null;
  try {
    styles = parseContent(await client.callTool({
      name: "get_styles",
      arguments: {}
    }));
  } catch (e) {
    console.warn("Could not fetch styles:", e.message);
  }

  const report = {
    runtimeInfo,
    documentName: initialDoc.name || "ListBox",
    pageCount: initialDoc.pageCount,
    pages: pagesInfo,
    styles
  };

  await fs.writeFile("/tmp/listbox-audit-result.json", JSON.stringify(report, null, 2));
  console.log("Audit complete and saved to /tmp/listbox-audit-result.json");
  process.exit(0);
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
