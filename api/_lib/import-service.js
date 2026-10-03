import { randomUUID } from "node:crypto";
import { AppError } from "./errors.js";
import { loadBaseData } from "./base-data.js";
import { prepareUpload } from "./parse-upload.js";
import { createRepository } from "./repository.js";
import { indexDatasets } from "../../js/core/catalog.js";
import { classifyUpload, publicRow } from "../../js/core/classify.js";

function countsMatch(actual, expected) {
  if (!expected) return true;
  return ["valid", "duplicate", "conflict", "error"].every((key) => Number(actual[key]) === Number(expected[key]));
}

function skippedDetails(rows) {
  const skipped = rows
    .filter((row) => row.status !== "valid")
    .slice(0, 500)
    .map((row) => ({ rowNumber: row.rowNumber, status: row.status, message: row.message }));
  return skipped;
}

async function classifyPrepared(runner, repo, prepared, asOf) {
  const active = await repo.loadActive(runner);
  const catalog = indexDatasets(loadBaseData(), active);
  return classifyUpload({ dataset: prepared.dataset, rows: prepared.rows, catalog, asOf });
}

export async function previewImport(db, input) {
  const prepared = await prepareUpload(input);
  const repo = createRepository(db);
  const previous = await repo.findActiveImportBySha(prepared.sha256);
  const result = await classifyPrepared(db, repo, prepared, input.asOf);
  return {
    dataset: prepared.dataset,
    filename: prepared.filename,
    sha256: prepared.sha256,
    alreadyImportedAt: previous ? previous.createdAt : null,
    alreadyImportedMessage: previous ? `This exact file was imported on ${previous.createdAt}.` : null,
    counts: result.counts,
    rows: result.rows.map(publicRow),
    fileErrors: [],
  };
}

export async function commitImport(db, input) {
  const prepared = await prepareUpload(input);
  if (!input.sha256) {
    throw new AppError("SHA256_REQUIRED", "Commit requires the sha256 from the preview.", 400);
  }
  if (String(input.sha256).toLowerCase() !== prepared.sha256) {
    throw new AppError("SHA256_MISMATCH", "The file does not match the previewed upload. Preview it again.", 400);
  }
  const repo = createRepository(db);
  return repo.transaction(async (tx) => {
    await repo.lockImports(tx);
    const previous = await repo.findActiveImportBySha(prepared.sha256, tx);
    if (previous) {
      throw new AppError(
        "ALREADY_IMPORTED",
        `This exact file was imported on ${previous.createdAt}. Nothing was imported again.`,
        409,
      );
    }
    const result = await classifyPrepared(tx, repo, prepared, input.asOf);
    const changedSincePreview = input.previewCounts ? !countsMatch(result.counts, input.previewCounts) : false;
    const validRows = result.rows.filter((row) => row.status === "valid");
    const importId = `IMP_${randomUUID()}`;
    await repo.insertImport(tx, {
      id: importId,
      dataset: prepared.dataset,
      filename: prepared.filename,
      fileSha256: prepared.sha256,
      totalRows: result.counts.total,
      importedCount: validRows.length,
      duplicateCount: result.counts.duplicate,
      conflictCount: result.counts.conflict,
      errorCount: result.counts.error,
      skipped: skippedDetails(result.rows),
      changedSincePreview,
    });
    const assignedIds = [];
    for (let index = 0; index < validRows.length; index += 1) {
      if (input.faultAfterInserts != null && index >= input.faultAfterInserts) {
        const failure = new Error("forced failure");
        failure.name = "ForcedFailure";
        throw failure;
      }
      const row = validRows[index];
      const entityId = await repo.mintId(tx, prepared.dataset);
      assignedIds.push(entityId);
      await repo.insertRecord(tx, {
        id: randomUUID(),
        dataset: prepared.dataset,
        recordKey: row.recordKey,
        contentHash: row.contentHash,
        entityId,
        data: { rows: row.toRows({ entityId }) },
        importId,
      });
    }
    return {
      importId,
      changedSincePreview,
      counts: result.counts,
      imported: validRows.length,
      rows: result.rows.map(publicRow),
      assignedIds,
    };
  });
}

export async function listHistory(db) {
  const repo = createRepository(db);
  return repo.listImports();
}

export async function revertImport(db, { importId, reason }) {
  if (!importId) throw new AppError("BAD_REQUEST", "importId is required.", 400);
  const cleanReason = String(reason || "").trim().slice(0, 500);
  const repo = createRepository(db);
  return repo.transaction(async (tx) => {
    await repo.lockImports(tx);
    const record = await repo.getImport(tx, importId);
    if (!record) throw new AppError("NOT_FOUND", "That import does not exist.", 404);
    if (record.revertedAt) throw new AppError("ALREADY_REVERTED", "That import is already reverted.", 409);
    const entities = await repo.entityIds(tx, importId);
    const later = await repo.laterActiveRecords(tx, record.createdAt, importId);
    const dependents = [];
    for (const item of later) {
      const text = JSON.stringify(item.data);
      const hits = entities.filter((id) => text.includes(`"${id}"`));
      if (!hits.length) continue;
      dependents.push({
        importId: item.importId,
        dataset: item.dataset,
        entityId: item.entityId,
        filename: item.filename,
        createdAt: item.createdAt,
        uses: hits,
      });
    }
    if (dependents.length) {
      const sample = dependents.slice(0, 8).map((item) => `${item.dataset} ${item.entityId} in ${item.filename} (${item.importId})`);
      const more = dependents.length > sample.length ? ` and ${dependents.length - sample.length} more` : "";
      throw new AppError(
        "DEPENDENTS",
        `This import cannot be reverted because later imports still use records it created: ${sample.join("; ")}${more}. Revert those imports first.`,
        409,
        { dependents: dependents.slice(0, 20) },
      );
    }
    await repo.markReverted(tx, importId, cleanReason || null);
    return { ok: true, importId };
  });
}

export async function loadPublicData(db) {
  const repo = createRepository(db);
  const { active, meta } = await repo.dataSnapshot();
  const grouped = {
    instructors: [],
    courses: [],
    groups: [],
    sessions: [],
    feedback: [],
    events: [],
  };
  for (const record of active) {
    const payload = record.data?.rows || record.data;
    const rows = Array.isArray(payload) ? payload : [payload];
    if (grouped[record.dataset]) grouped[record.dataset].push(...rows);
  }
  return {
    ...grouped,
    meta: {
      lastUpdatedAt: meta?.last_updated_at ? new Date(meta.last_updated_at).toISOString() : null,
      importCount: Number(meta?.import_count || 0),
    },
  };
}
