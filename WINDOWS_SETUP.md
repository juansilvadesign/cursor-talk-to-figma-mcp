# Windows 10/11 Setup Guide for Cursor Talk to Figma MCP

This guide provides step-by-step instructions for setting up the Cursor Talk to Figma MCP project on Windows 10/11.

## Prerequisites

1. **Windows 10/11** (64-bit)
2. **PowerShell** (included with Windows)
3. **Git** (optional, for cloning the repository)

## Installation Steps

### Step 1: Install Bun

Open PowerShell as Administrator and run:

```powershell
powershell -c "irm bun.sh/install.ps1|iex"
```

After installation, restart your terminal/PowerShell.

### Step 2: Clone or Download the Project

If using Git:
```bash
git clone https://github.com/your-repo/cursor-talk-to-figma-mcp.git
cd cursor-talk-to-figma-mcp
```

Or download and extract the ZIP file, then navigate to the project directory.

### Step 3: Setup the Project

Choose one of the following methods:

#### Method A: PowerShell Setup (Recommended)
```powershell
bun run setup:ps
```

#### Method B: Command Prompt Setup
```cmd
bun run setup:win
```

#### Method C: Manual Setup
```bash
bun run setup
```

The setup command installs from `bun.lock`, builds `dist/server.js`, and writes an
absolute local path to `.cursor/mcp.json` and `.mcp.json`. Do not substitute npm
`latest`; it does not contain this fork's R0 runtime identity and complete tool set.

### Step 4: Start the WebSocket Server

```bash
bun socket
```

You should see: `WebSocket server running on port 3055`

### Step 5: Start the configured MCP client

Restart Cursor or Claude Code after `bun run setup`. It launches this checkout's built
`dist/server.js`; no second `bunx` server process is required.

### Step 6: Install the Figma Plugin

1. Open Figma
2. Go to Plugins > Development > New Plugin
3. Choose "Link existing plugin"
4. Select the `src/cursor_mcp_plugin/manifest.json` file from your project directory
5. Join the displayed channel, then verify `get_runtime_info` reports a compatible
   server/plugin pair before document operations

## Troubleshooting

### Common Issues

#### Issue 1: "bun is not recognized"
**Solution**: Restart your terminal after installing Bun, or add Bun to your PATH manually.

#### Issue 2: PowerShell execution policy error
**Solution**: Run PowerShell as Administrator and execute:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

#### Issue 3: WebSocket connection failed
**Solution**: 
1. Make sure the WebSocket server is running (`bun socket`)
2. Check if port 3055 is not blocked by Windows Firewall
3. Try running as Administrator if needed

#### Issue 4: MCP server not found in Cursor
**Solution**:
1. Verify `.cursor/mcp.json` exists and has correct content
2. Restart Cursor after creating the MCP configuration
3. Check Cursor's MCP settings in Preferences

#### Issue 5: Permission denied errors
**Solution**: Run your terminal/PowerShell as Administrator

### Windows Firewall Configuration

If you encounter connection issues, you may need to allow the application through Windows Firewall:

1. Open Windows Security
2. Go to Firewall & network protection
3. Click "Allow an app through firewall"
4. Add the Bun executable or your project directory

### Port Configuration

The WebSocket server runs on port 3055. If this port is in use:

1. Find what's using the port:
```cmd
netstat -ano | findstr :3055
```

2. Kill the process or change the port in `src/socket.ts`

### Alternative: Using WSL (Windows Subsystem for Linux)

If you prefer using Linux tools:

1. Install WSL2:
```powershell
wsl --install
```

2. Install Bun in WSL:
```bash
curl -fsSL https://bun.sh/install | bash
```

3. Run the original setup script:
```bash
bun run setup
```

## File Structure After Setup

Your project should have this structure:
```
cursor-talk-to-figma-mcp/
├── .cursor/
│   └── mcp.json          # MCP configuration
├── scripts/
│   ├── setup.sh          # Linux/macOS setup
│   ├── setup.bat         # Windows batch setup
│   └── setup.ps1         # Windows PowerShell setup
├── src/
│   ├── socket.ts         # WebSocket server
│   └── talk_to_figma_mcp/
│       └── server.ts     # MCP server
└── package.json
```

## Verification

To verify everything is working:

1. **WebSocket Server**: Should show "WebSocket server running on port 3055"
2. **MCP Configuration**: Check `.cursor/mcp.json` exists and has correct content
3. **Figma Plugin**: Should appear in Figma's development plugins
4. **Cursor Integration**: MCP tools should be available in Cursor

## Support

If you encounter issues not covered in this guide:

1. Check the main README.md for general troubleshooting
2. Verify your Windows version and PowerShell version
3. Try running commands as Administrator
4. Check Windows Event Viewer for system errors

## Performance Tips for Windows

1. **Use PowerShell**: Generally faster than Command Prompt for this project
2. **Run as Administrator**: Avoids many permission issues
3. **Disable Windows Defender**: Temporarily disable real-time protection if you encounter false positives
4. **Use WSL2**: For better performance with Node.js/Bun tools
