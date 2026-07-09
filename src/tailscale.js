const { execFile } = require("child_process");
const { CONFIG } = require("./config");

function getPortLabels() {
  return CONFIG.tailscale?.portLabels || {};
}

function labelForPort(port) {
  return getPortLabels()[String(port)] || "";
}

function getTailscaleServes() {
  return new Promise((resolve) => {
    const tailscaleBin = CONFIG.tools?.tailscaleBinary || "tailscale";

    execFile(
      tailscaleBin,
      ["serve", "status", "--json"],
      { encoding: "utf8", timeout: 5000 },
      (err, stdout) => {
        if (err) {
          execFile(
            tailscaleBin,
            ["serve", "status"],
            { encoding: "utf8", timeout: 5000 },
            (err2, stdout2) => {
              if (err2) {
                resolve({ serves: [], error: err2.message });
                return;
              }

              resolve({ serves: parseTailscaleServePlaintext(stdout2) });
            },
          );
          return;
        }

        try {
          resolve({ serves: parseTailscaleServeJson(JSON.parse(stdout)) });
        } catch (e) {
          resolve({ serves: parseTailscaleServePlaintext(stdout) });
        }
      },
    );
  });
}

/**
 * Parse `tailscale serve status --json` output into a flat array of serve rows.
 * JSON shape (v1.60+):
 *   { TCP: { "443": { Handlers: { "/": { Proxy: "http://127.0.0.1:18789" } } } }, ... }
 * or the newer flat shape:
 *   { Services: [ { Proto, Addr, Handler, ... } ] }
 */
function parseTailscaleServeJson(json) {
  const rows = [];

  // Canonical shape: json.Web = { "hostname:PORT": { Handlers: { "/": { Proxy: "..." } } } }
  // Also check json.TCP for HTTPS flag and json.AllowFunnel for funnel status.
  if (json.Web && typeof json.Web === "object") {
    const funnelPorts = new Set(
      Object.keys(json.AllowFunnel || {}).map((k) => k.split(":").pop()),
    );

    for (const [hostPort, webCfg] of Object.entries(json.Web)) {
      const port = hostPort.split(":").pop() || "443";
      const isFunnel = funnelPorts.has(port);
      const handlers = webCfg.Handlers || {};
      for (const [servePath, handlerCfg] of Object.entries(handlers)) {
        rows.push({
          proto: "https",
          port,
          handler: handlerCfg.Proxy || handlerCfg.Text || handlerCfg.Path || "-",
          path: servePath,
          mode: isFunnel ? "funnel" : "tailnet",
          label: labelForPort(port),
        });
      }
      if (!Object.keys(handlers).length) {
        rows.push({
          proto: "https",
          port,
          handler: "-",
          path: "/",
          mode: isFunnel ? "funnel" : "tailnet",
          label: labelForPort(port),
        });
      }
    }
    return rows;
  }

  // Newer flat Services array
  if (Array.isArray(json.Services)) {
    for (const s of json.Services) {
      const port = String(s.Port || s.Addr || "-");
      rows.push({
        proto: s.Protocol || s.Proto || "https",
        port,
        handler: s.Handler || s.Backend || s.Proxy || "-",
        path: s.MountPoint || s.Path || "/",
        mode: s.Funnel ? "funnel" : "tailnet",
        label: labelForPort(port),
      });
    }
    return rows;
  }

  // Fallback: TCP map shape
  for (const [port, portCfg] of Object.entries(json.TCP || {})) {
    const handlers = portCfg.Handlers || {};
    for (const [servePath, handlerCfg] of Object.entries(handlers)) {
      rows.push({
        proto: "https",
        port,
        handler: handlerCfg.Proxy || handlerCfg.Text || handlerCfg.Path || "-",
        path: servePath,
        mode: handlerCfg.Funnel ? "funnel" : "tailnet",
        label: labelForPort(port),
      });
    }
    if (!Object.keys(handlers).length) {
      rows.push({
        proto: "https",
        port,
        handler: portCfg.TCPForward || "-",
        path: "/",
        mode: "tailnet",
        label: labelForPort(port),
      });
    }
  }
  return rows;
}

/**
 * Parse plain-text `tailscale serve status` output into serve rows.
 * Typical line: "https://hostname.tail...ts.net:3333  /  http://127.0.0.1:3333"
 */
function parseTailscaleServePlaintext(text) {
  const rows = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    // Match lines like: https://...:PORT  PATH  BACKEND
    const m = trimmed.match(/^(https?):\/\/[^\s]+?(:(\d+))?\/?(\S*)\s+(\S+)/);
    if (m) {
      const port = m[3] || "443";
      rows.push({
        proto: m[1],
        port,
        handler: m[5] || "-",
        path: "/" + (m[4] || ""),
        mode: line.includes("funnel") ? "funnel" : "tailnet",
        label: labelForPort(port),
      });
    } else if (trimmed.match(/^\d+/)) {
      // Compact format: PORT  PROTO  BACKEND
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 3) {
        const port = parts[0];
        rows.push({
          proto: parts[1] || "https",
          port,
          handler: parts[2],
          path: "/",
          mode: "tailnet",
          label: labelForPort(port),
        });
      }
    }
  }
  return rows;
}

module.exports = { getTailscaleServes };
