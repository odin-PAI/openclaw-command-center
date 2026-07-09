/**
 * Cron job data via direct SQLite read.
 *
 * The Gateway's /tools/invoke endpoint blocks the `cron` tool,
 * so we read the cron_jobs table from the gateway's SQLite state
 * database directly.
 */

const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const { getOpenClawDir } = require("./config");

/**
 * Get the path to the OpenClaw state database.
 */
function getStateDbPath() {
  return path.join(getOpenClawDir(), "state", "openclaw.sqlite");
}

/**
 * Read cron jobs from the SQLite state database.
 */
function readCronJobsFromDb(dbPath) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return db
      .prepare(
        `
        SELECT job_id, name, agent_id, enabled, schedule_kind, schedule_expr,
               schedule_tz, next_run_at_ms, last_run_status, last_run_at_ms,
               last_error, last_duration_ms, description, payload_kind, session_target
        FROM cron_jobs ORDER BY agent_id, name
      `,
      )
      .all();
  } finally {
    db.close();
  }
}

// Cache
let cronCache = { data: null, timestamp: 0 };
const CRON_CACHE_TTL_MS = 30000;

/**
 * Get cron jobs. Returns cached data, refreshes in background if stale.
 */
function getCronJobs() {
  const now = Date.now();

  if (cronCache.data && now - cronCache.timestamp < CRON_CACHE_TTL_MS) {
    return cronCache.data;
  }

  try {
    const dbPath = getStateDbPath();
    const rawJobs = readCronJobsFromDb(dbPath);

    const jobs = rawJobs.map((j) => ({
      id: j.job_id,
      name: j.name || "Unnamed",
      agentId: j.agent_id || "main",
      enabled: !!j.enabled,
      scheduleKind: j.schedule_kind,
      scheduleExpr: j.schedule_expr,
      scheduleTz: j.schedule_tz,
      nextRunAtMs: j.next_run_at_ms,
      lastRunStatus: j.last_run_status,
      lastRunAtMs: j.last_run_at_ms,
      lastError: j.last_error,
      lastDurationMs: j.last_duration_ms,
      description: j.description,
      payloadKind: j.payload_kind,
      sessionTarget: j.session_target,
    }));

    const result = {
      jobs,
      total: jobs.length,
      enabled: jobs.filter((j) => j.enabled).length,
      errored: jobs.filter((j) => j.lastRunStatus === "error").length,
    };

    cronCache.data = result;
    cronCache.timestamp = now;
    console.log(
      `[Cron] Refreshed: ${result.total} jobs (${result.enabled} enabled, ${result.errored} errored)`,
    );
    return result;
  } catch (e) {
    console.error("[Cron] Failed to read SQLite:", e.message);
    return cronCache.data || { jobs: [], total: 0, enabled: 0, errored: 0 };
  }
}

module.exports = { getCronJobs, getStateDbPath, readCronJobsFromDb };
