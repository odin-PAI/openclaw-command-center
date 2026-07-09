const { execFile } = require("child_process");
const { CONFIG } = require("./config");

function resolvePm2Candidates() {
  return [
    process.env.PM2_BIN,
    CONFIG.tools?.pm2Binary,
    "/usr/local/bin/pm2",
    "/usr/bin/pm2",
    "pm2",
  ].filter(Boolean);
}

function parsePm2Jlist(stdout) {
  try {
    const raw = JSON.parse(stdout);
    return raw.map((p) => ({
      name: p.name,
      status: p.pm2_env?.status || "unknown",
      pid: p.pid,
      uptime: p.pm2_env?.pm_uptime || null,
      memory: p.monit?.memory || 0,
      cpu: p.monit?.cpu ?? 0,
      restarts: p.pm2_env?.restart_time ?? 0,
      mode: p.pm2_env?.exec_mode || "fork",
    }));
  } catch (e) {
    return [];
  }
}

function getPm2Processes() {
  return new Promise((resolve) => {
    const candidates = resolvePm2Candidates();
    let lastError = "pm2 not found";

    const tryNext = (i) => {
      if (i >= candidates.length) {
        resolve({ processes: [], error: lastError });
        return;
      }

      execFile(candidates[i], ["jlist"], { encoding: "utf8", timeout: 8000 }, (err, stdout) => {
        if (err) {
          lastError = err.message;
          tryNext(i + 1);
          return;
        }

        resolve({ processes: parsePm2Jlist(stdout) });
      });
    };

    tryNext(0);
  });
}

module.exports = { getPm2Processes };
