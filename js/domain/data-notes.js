/** Provenance lines shared by the footer and the PDF data-notes section. */
export function dataQualityNotes(overview, idx) {
  const unmappedDistinct = new Set((idx?.unmappedFeedback || []).map((row) => row.feedback_id)).size;
  const coverage = overview?.student_count_coverage || {};
  const notes = [
    `Data as of ${overview?.as_of_date || '—'}`,
    `Historical series from ${overview?.clean_series_first_month || '—'}`,
    `${Number(overview?.total_feedback || 0).toLocaleString()} distinct feedback responses`,
    `${unmappedDistinct} unmapped feedback (not attached to groups)`,
    `Student counts: ${coverage.activities_with_students}/${coverage.total_activities} activities`,
  ];
  if (overview?.teaching_hour_coverage) {
    const hours = overview.teaching_hour_coverage;
    notes.push(`Teaching-hour coverage: ${hours.pct}% of historical sessions (${Number(hours.sessions_with_hours).toLocaleString()} of ${Number(hours.total_sessions).toLocaleString()})`);
  }
  if (overview?.legacy_sessions_provenance) notes.push(overview.legacy_sessions_provenance);
  return notes;
}
