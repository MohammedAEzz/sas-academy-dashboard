import { mapStorageError } from "./errors.js";

const ID_SPEC = {
  instructors: { prefix: "INS_U", width: 4 },
  courses: { prefix: "CRS_U", width: 4 },
  groups: { prefix: "ACT_U", width: 5 },
  sessions: { prefix: "SES_U", width: 6 },
  feedback: { prefix: "FB_U", width: 6 },
  events: { prefix: "EVT_U", width: 3 },
};

export function idSpec(dataset) {
  return ID_SPEC[dataset];
}

function isoDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function day(value) {
  const iso = isoDate(value);
  return iso ? iso.slice(0, 10) : null;
}

export function createRepository(db) {
  async function query(runner, text, params) {
    try {
      return await runner.query(text, params);
    } catch (error) {
      throw mapStorageError(error);
    }
  }

  return {
    idSpec,
    async transaction(fn) {
      try {
        return await db.transaction(async (tx) => fn(tx));
      } catch (error) {
        throw mapStorageError(error);
      }
    },
    async lockImports(tx) {
      await query(tx, "SELECT pg_advisory_xact_lock($1::integer, $2::integer)", [8419, 1]);
    },
    async mintId(tx, dataset) {
      const spec = ID_SPEC[dataset];
      const result = await query(
        tx,
        `INSERT INTO id_counters (prefix, value) VALUES ($1, 1)
         ON CONFLICT (prefix) DO UPDATE SET value = id_counters.value + 1
         RETURNING value`,
        [spec.prefix],
      );
      const value = Number(result.rows[0].value);
      return `${spec.prefix}${String(value).padStart(spec.width, "0")}`;
    },
    async loadActive(runner = db) {
      const result = await query(
        runner,
        `SELECT r.dataset, r.record_key, r.content_hash, r.entity_id, r.data,
                i.id AS import_id, i.filename, i.created_at
         FROM records r
         JOIN imports i ON i.id = r.import_id
         WHERE r.reverted_at IS NULL AND i.reverted_at IS NULL`,
      );
      return result.rows.map((row) => ({
        dataset: row.dataset,
        recordKey: row.record_key,
        contentHash: row.content_hash,
        entityId: row.entity_id,
        data: typeof row.data === "string" ? JSON.parse(row.data) : row.data,
        source: `import ${row.filename} (${row.import_id}) on ${day(row.created_at)}`,
      }));
    },
    async findActiveImportBySha(sha, runner = db) {
      const result = await query(
        runner,
        `SELECT id, created_at FROM imports
         WHERE file_sha256 = $1 AND reverted_at IS NULL
         ORDER BY created_at ASC
         LIMIT 1`,
        [sha],
      );
      const row = result.rows[0];
      if (!row) return null;
      return { id: row.id, createdAt: day(row.created_at) };
    },
    async insertImport(tx, row) {
      await query(
        tx,
        `INSERT INTO imports (
           id, dataset, filename, file_sha256, total_rows, imported_count, duplicate_count,
           conflict_count, error_count, skipped_row_details, changed_since_preview
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)`,
        [
          row.id,
          row.dataset,
          row.filename,
          row.fileSha256,
          row.totalRows,
          row.importedCount,
          row.duplicateCount,
          row.conflictCount,
          row.errorCount,
          JSON.stringify(row.skipped),
          row.changedSincePreview,
        ],
      );
    },
    async insertRecord(tx, row) {
      await query(
        tx,
        `INSERT INTO records (id, dataset, record_key, content_hash, entity_id, data, import_id)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
        [row.id, row.dataset, row.recordKey, row.contentHash, row.entityId, JSON.stringify(row.data), row.importId],
      );
    },
    async listImports() {
      const result = await query(
        db,
        `SELECT id, dataset, filename, file_sha256, total_rows, imported_count, duplicate_count,
                conflict_count, error_count, skipped_row_details, created_at, reverted_at, revert_reason
         FROM imports
         ORDER BY created_at DESC`,
      );
      return result.rows.map(mapImport);
    },
    async getImport(runner, id) {
      const result = await query(
        runner,
        `SELECT id, dataset, filename, file_sha256, total_rows, imported_count, duplicate_count,
                conflict_count, error_count, created_at, reverted_at, revert_reason
         FROM imports WHERE id = $1`,
        [id],
      );
      return result.rows[0] ? mapImport(result.rows[0]) : null;
    },
    async entityIds(runner, importId) {
      const result = await query(
        runner,
        `SELECT entity_id FROM records WHERE import_id = $1 AND reverted_at IS NULL`,
        [importId],
      );
      return result.rows.map((row) => row.entity_id);
    },
    async laterActiveRecords(runner, createdAt, importId) {
      const result = await query(
        runner,
        `SELECT r.dataset, r.entity_id, r.data, i.id AS import_id, i.filename, i.created_at
         FROM records r
         JOIN imports i ON i.id = r.import_id
         WHERE r.reverted_at IS NULL
           AND i.reverted_at IS NULL
           AND i.id <> $2
           AND i.created_at >= $1`,
        [createdAt, importId],
      );
      return result.rows.map((row) => ({
        dataset: row.dataset,
        entityId: row.entity_id,
        data: typeof row.data === "string" ? JSON.parse(row.data) : row.data,
        importId: row.import_id,
        filename: row.filename,
        createdAt: isoDate(row.created_at),
      }));
    },
    async markReverted(tx, importId, reason) {
      await query(
        tx,
        `UPDATE imports SET reverted_at = now(), revert_reason = $2 WHERE id = $1 AND reverted_at IS NULL`,
        [importId, reason],
      );
      await query(
        tx,
        `UPDATE records SET reverted_at = now() WHERE import_id = $1 AND reverted_at IS NULL`,
        [importId],
      );
    },
    async dataSnapshot() {
      const active = await this.loadActive();
      const meta = await query(
        db,
        `SELECT
           (SELECT COUNT(*) FROM imports WHERE reverted_at IS NULL AND imported_count >= 1) AS import_count,
           (SELECT MAX(created_at) FROM imports WHERE reverted_at IS NULL AND imported_count >= 1) AS last_updated_at`,
      );
      return { active, meta: meta.rows[0] };
    },
    async countRecords() {
      const result = await query(db, "SELECT COUNT(*) AS n FROM records");
      return Number(result.rows[0].n);
    },
    async countImports() {
      const result = await query(db, "SELECT COUNT(*) AS n FROM imports");
      return Number(result.rows[0].n);
    },
    async countRecentFailures(client, runner = db) {
      const result = await query(
        runner,
        `SELECT COUNT(*) AS n FROM login_attempts
         WHERE client_key = $1 AND success = FALSE AND attempted_at > now() - interval '15 minutes'`,
        [client],
      );
      return Number(result.rows[0].n);
    },
    async recordLoginAttempt(client, success) {
      await query(
        db,
        `INSERT INTO login_attempts (client_key, success) VALUES ($1, $2)`,
        [client, success],
      );
    },
  };
}

function jsonList(value) {
  if (value == null) return [];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(value) ? value : [];
}

function mapImport(row) {
  const mapped = {
    id: row.id,
    dataset: row.dataset,
    filename: row.filename,
    fileSha256: row.file_sha256,
    totalRows: row.total_rows,
    importedCount: row.imported_count,
    duplicateCount: row.duplicate_count,
    conflictCount: row.conflict_count,
    errorCount: row.error_count,
    createdAt: isoDate(row.created_at),
    revertedAt: isoDate(row.reverted_at),
    revertReason: row.revert_reason || null,
  };
  if ("skipped_row_details" in row) mapped.skipped = jsonList(row.skipped_row_details);
  return mapped;
}
