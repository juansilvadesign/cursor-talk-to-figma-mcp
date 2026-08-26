import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "node:path";
import fs from "node:fs/promises";

const root = "/home/jaypy/GitHub-Projects/Notes/ai-synthesizer/knowledge/projects/talk-to-figma-fork";
const serverPath = path.join(root, "dist/server.js");

const channel = process.argv[2] || "28e2fym3";

const client = new Client({ name: "fast-audit", version: "1.0.0" }, { capabilities: {} });
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
  console.log(`Joining channel ${channel}...`);
  const joinRes = parse(await client.callTool({
    name: "join_channel",
    arguments: { channel }
  }));
  console.log("Join result:", joinRes);

  const initialDoc = parse(await client.callTool({
    name: "get_document_info",
    arguments: { summary: true }
  }));

  console.log(`Document: ${initialDoc.name}, Page count: ${initialDoc.pageCount}`);
  const pagesSummary = [];

  for (const p of initialDoc.pages || []) {
    console.log(`Reading page: ${p.name} (${p.id})...`);
    await client.callTool({
      name: "set_current_page",
      arguments: { pageId: p.id }
    });

    const pageInfo = parse(await client.callTool({
      name: "get_document_info",
      arguments: { summary: true, limit: 50 }
    }));

    pagesSummary.push({
      id: p.id,
      name: p.name,
      childCount: pageInfo.currentPage?.childCount ?? pageInfo.children?.length ?? 0,
      childTypes: pageInfo.childTypes || [],
      childFamilies: pageInfo.childFamilies || [],
      topChildren: (pageInfo.children || []).map(c => ({ id: c.id, name: c.name, type: c.type }))
    });
  }

  // Restore Cover
  if (initialDoc.pages && initialDoc.pages.length > 0) {
    await client.callTool({
      name: "set_current_page",
      arguments: { pageId: initialDoc.pages[0].id }
    });
  }

  const result = {
    documentName: initialDoc.name || "ListBox",
    documentId: initialDoc.document?.id || "0:0",
    pageCount: initialDoc.pageCount,
    pages: pagesSummary
  };

  console.log("RESULT_JSON_START");
  console.log(JSON.stringify(result, null, 2));
  console.log("RESULT_JSON_END");
  process.exit(0);
}

main().catch(err => {
  console.error("Audit error:", err);
  process.exit(1);
});
