const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron')
const path = require('path')
const os = require('os')
const http = require('http')
const { exec: _exec, spawn, spawnSync } = require('child_process')
const { promisify } = require('util')

const execAsync = promisify(_exec)

const DEV_URL = 'http://localhost:5173'
const SERVICE_NAME = 'PEPEService'
const CERT_DIR = 'C:\\ProgramData\\PEPE\\mitmproxy'

// Path to the bundled service executable
function serviceExePath() {
  const base = app.isPackaged ? process.resourcesPath : path.join(__dirname, 'resources')
  return path.join(base, 'pepe-service.exe')
}

function checkDevServer() {
  return new Promise((resolve) => {
    const req = http.get(DEV_URL, () => resolve(true))
    req.on('error', () => resolve(false))
    req.setTimeout(500, () => { req.destroy(); resolve(false) })
  })
}

function isRunningAsAdmin() {
  if (process.platform !== 'win32') return true

  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-WindowStyle', 'Hidden',
    '-Command',
    '[bool]([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)',
  ], {
    encoding: 'utf8',
    windowsHide: true,
  })

  if (result.error) return false
  return String(result.stdout || '').trim().toLowerCase() === 'true'
}

async function warnIfNotAdmin() {
  if (process.platform !== 'win32' || isRunningAsAdmin()) return

  await dialog.showMessageBox({
    type: 'warning',
    buttons: ['OK'],
    defaultId: 0,
    title: 'Administrator Required',
    message: 'PEPE is not running as Administrator.',
    detail: 'Some capture and service features require elevated privileges. Close the app and reopen it using "Run as administrator" for full functionality.',
  })
}

let win

async function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 960,
    minWidth: 1100,
    minHeight: 650,
    frame: false,
    backgroundColor: '#000000',
    titleBarStyle: 'hidden',
    icon: path.join(__dirname, 'resources', 'pepe.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'electron-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  })

  const useDev = await checkDevServer()
  if (useDev) {
    win.loadURL(DEV_URL)
  } else {
    win.loadFile(path.join(__dirname, 'dist', 'index.html'))
  }

  win.once('ready-to-show', () => win.show())

  // Confirm before close — delegate to the renderer for a styled dialog
  win.on('close', (e) => {
    if (win._forceClose) return
    e.preventDefault()
    win.webContents.send('request-close')
  })

  // Open external links in the system browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

// ── IPC: window controls ───────────────────────────────────────────────────

ipcMain.on('window-minimize', () => win?.minimize())
ipcMain.on('window-maximize', () => {
  if (win?.isMaximized()) win.unmaximize()
  else win?.maximize()
})
ipcMain.on('window-close', () => win?.close())
ipcMain.on('confirm-close', () => {
  if (win) { win._forceClose = true; win.close() }
})
ipcMain.on('open-devtools', () => win?.webContents.openDevTools())

ipcMain.handle('window-is-maximized', () => win?.isMaximized() ?? false)

// Open the shared cert folder (works regardless of who created the confdir)
ipcMain.on('open-cert-folder', () => {
  shell.openPath(CERT_DIR)
})

// ── IPC: background service ────────────────────────────────────────────────

// Run a command string elevated via UAC (one UAC prompt for the whole chain)
function runElevated(cmd) {
  // Escape single-quotes inside the command for PS string wrapping
  const escaped = cmd.replace(/'/g, "''")
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
      '-Command',
      `$p = Start-Process cmd.exe -ArgumentList '/c ${escaped}' -Verb RunAs -Wait -PassThru; exit $p.ExitCode`,
    ])
    let stderr = ''
    ps.stderr?.on('data', d => { stderr += d.toString() })
    ps.on('close', code => {
      if (code === 0) resolve()
      else reject(new Error(`Elevated command failed (exit ${code})${stderr ? ': ' + stderr.trim() : ''}`))
    })
    ps.on('error', reject)
  })
}

ipcMain.handle('service-status', async () => {
  try {
    const { stdout } = await execAsync(`sc query ${SERVICE_NAME}`)
    const m = stdout.match(/STATE\s+:\s+\d+\s+(\w+)/)
    return { installed: true, state: m ? m[1] : 'UNKNOWN' }
  } catch {
    return { installed: false, state: 'NOT_INSTALLED' }
  }
})

ipcMain.handle('service-install', async () => {
  const exe = serviceExePath()
  // sc binPath= requires inner quotes for paths with spaces
  const binPath = `\\"${exe}\\"`
  // Always uninstall first so binPath is always refreshed to the current exe location
  const cmd = [
    `sc stop ${SERVICE_NAME}`,           // ignore error if not running
    `sc delete ${SERVICE_NAME}`,         // ignore error if not installed
    `sc create ${SERVICE_NAME} binPath= ${binPath} start= auto DisplayName= "PEPE Background Network Sniffer"`,
    `sc description ${SERVICE_NAME} "PEPE transparent HTTP/S proxy and capture API (port 8080/7779)"`,
    `sc start ${SERVICE_NAME}`,
  ].join(' & ')  // & not && so failures on stop/delete don't abort the chain
  await runElevated(cmd)
})

// start/stop run directly — app must be running as admin for these to work,
// which is also required for install, so if install succeeded the user is admin.
ipcMain.handle('service-start', async () => {
  try {
    await execAsync(`sc start ${SERVICE_NAME}`)
  } catch (e) {
    const msg = (e.stderr || e.stdout || e.message || '').trim()
    throw new Error(msg || `sc start failed (exit ${e.code})`)
  }
})

ipcMain.handle('service-stop', async () => {
  try {
    await execAsync(`sc stop ${SERVICE_NAME}`)
  } catch (e) {
    const msg = (e.stderr || e.stdout || e.message || '').trim()
    throw new Error(msg || `sc stop failed (exit ${e.code})`)
  }
})

ipcMain.handle('service-uninstall', async () => {
  const cmd = `sc stop ${SERVICE_NAME} & sc delete ${SERVICE_NAME}`
  await runElevated(cmd)
})

// Notify WinINet of proxy settings change from the USER's session.
// The SYSTEM service writes the correct registry keys but can't send
// cross-session notifications (Session 0 isolation).
ipcMain.handle('notify-proxy-change', async () => {
  try {
    await execAsync(
      'powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -Command "' +
      "Add-Type -TypeDefinition 'using System.Runtime.InteropServices; " +
      'public class WI { [DllImport(\\"wininet.dll\\")] ' +
      'public static extern bool InternetSetOption(System.IntPtr h, int o, System.IntPtr b, int l); }\'; ' +
      '[WI]::InternetSetOption([System.IntPtr]::Zero,39,[System.IntPtr]::Zero,0); ' +
      '[WI]::InternetSetOption([System.IntPtr]::Zero,37,[System.IntPtr]::Zero,0)"'
    )
  } catch { /* best-effort */ }
})

ipcMain.handle('service-run-interactive', async () => {
  const exe = serviceExePath()
  const child = spawn(exe, ['--interactive'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  })
  child.unref()
})

// ── App lifecycle ──────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  await warnIfNotAdmin()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
