import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { InstalledBrowser } from "./types.js";

const HOME = os.homedir();
const LOCAL_APP_DATA = process.env.LOCALAPPDATA ?? path.join(HOME, "AppData", "Local");
const PROGRAM_FILES = process.env.ProgramFiles ?? "C:\\Program Files";
const PROGRAM_FILES_X86 = process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)";

function windowsCandidates(): InstalledBrowser[] {
  return [
    {
      name: "Brave",
      executable: path.join(PROGRAM_FILES, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
      userDataDir: path.join(LOCAL_APP_DATA, "BraveSoftware", "Brave-Browser", "User Data"),
    },
    {
      name: "Brave",
      executable: path.join(PROGRAM_FILES_X86, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
      userDataDir: path.join(LOCAL_APP_DATA, "BraveSoftware", "Brave-Browser", "User Data"),
    },
    {
      name: "Chrome",
      executable: path.join(PROGRAM_FILES, "Google", "Chrome", "Application", "chrome.exe"),
      userDataDir: path.join(LOCAL_APP_DATA, "Google", "Chrome", "User Data"),
    },
    {
      name: "Edge",
      executable: path.join(PROGRAM_FILES_X86, "Microsoft", "Edge", "Application", "msedge.exe"),
      userDataDir: path.join(LOCAL_APP_DATA, "Microsoft", "Edge", "User Data"),
    },
  ];
}

function macCandidates(): InstalledBrowser[] {
  const support = path.join(HOME, "Library", "Application Support");
  return [
    {
      name: "Brave",
      executable: "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      userDataDir: path.join(support, "BraveSoftware", "Brave-Browser"),
    },
    {
      name: "Chrome",
      executable: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      userDataDir: path.join(support, "Google", "Chrome"),
    },
    {
      name: "Edge",
      executable: "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      userDataDir: path.join(support, "Microsoft Edge"),
    },
  ];
}

function linuxCandidates(): InstalledBrowser[] {
  const config = process.env.XDG_CONFIG_HOME ?? path.join(HOME, ".config");
  return [
    {
      name: "Brave",
      executable: "/usr/bin/brave-browser",
      userDataDir: path.join(config, "BraveSoftware", "Brave-Browser"),
    },
    {
      name: "Chrome",
      executable: "/usr/bin/google-chrome",
      userDataDir: path.join(config, "google-chrome"),
    },
    {
      name: "Chromium",
      executable: "/usr/bin/chromium",
      userDataDir: path.join(config, "chromium"),
    },
    {
      name: "Edge",
      executable: "/usr/bin/microsoft-edge",
      userDataDir: path.join(config, "microsoft-edge"),
    },
  ];
}

function candidates(): InstalledBrowser[] {
  if (process.platform === "win32") return windowsCandidates();
  if (process.platform === "darwin") return macCandidates();
  return linuxCandidates();
}

export function defaultBrowserName(): string | null {
  try {
    if (process.platform === "win32") {
      const out = spawnSync(
        "reg",
        [
          "query",
          "HKCU\\Software\\Microsoft\\Windows\\Shell\\Associations\\UrlAssociations\\https\\UserChoice",
          "/v",
          "ProgId",
        ],
        { encoding: "utf8", shell: true },
      ).stdout;
      if (/Brave/i.test(out)) return "Brave";
      if (/Chrome/i.test(out)) return "Chrome";
      if (/MSEdge/i.test(out)) return "Edge";
      return null;
    }

    if (process.platform === "linux") {
      const out = spawnSync("xdg-settings", ["get", "default-web-browser"], {
        encoding: "utf8",
      }).stdout;
      if (/brave/i.test(out)) return "Brave";
      if (/chromium/i.test(out)) return "Chromium";
      if (/chrome/i.test(out)) return "Chrome";
      if (/edge/i.test(out)) return "Edge";
      return null;
    }

    const out = spawnSync(
      "sh",
      [
        "-c",
        "defaults read ~/Library/Preferences/com.apple.LaunchServices/com.apple.launchservices.secure.plist 2>/dev/null | grep -A2 'https' | grep LSHandlerRoleAll",
      ],
      { encoding: "utf8" },
    ).stdout;
    if (/brave/i.test(out)) return "Brave";
    if (/chrome/i.test(out)) return "Chrome";
    if (/edge/i.test(out)) return "Edge";
    return null;
  } catch {
    return null;
  }
}

export function findBrowsers(): InstalledBrowser[] {
  const installed = candidates().filter((b) => fs.existsSync(b.executable));
  const seen = new Set<string>();
  const unique = installed.filter((b) => {
    if (seen.has(b.executable)) return false;
    seen.add(b.executable);
    return true;
  });

  const preferred = defaultBrowserName();
  if (!preferred) return unique;

  return [
    ...unique.filter((b) => b.name === preferred),
    ...unique.filter((b) => b.name !== preferred),
  ];
}

export function findBrowser(preferred?: string): InstalledBrowser | null {
  const browsers = findBrowsers();
  if (preferred) {
    return browsers.find((b) => b.name.toLowerCase() === preferred.toLowerCase()) ?? null;
  }
  return browsers[0] ?? null;
}

export function hasDisplay(): boolean {
  if (process.platform === "win32" || process.platform === "darwin") return true;
  return Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
}
