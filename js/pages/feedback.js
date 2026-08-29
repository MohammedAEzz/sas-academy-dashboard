import {
  filterFeedback, feedbackMetrics, satisfactionTrend, ratingDistribution,
  perQuestionBreakdown, fmt, fmtAvg,
} from '../metrics.js';
import {
  renderKpiRow, renderChartCard, renderComments, renderWordFrequencyPanel,
  renderTableCard, renderCardEmpty, bindCommentsToggle,
} from '../components.js';
import {
  renderLineChart, renderBarChart, renderDonut, renderGroupedBarChart, colorFor,
} from '../charts.js';
import { activityTypeLabel } from '../format.js';
import { dedupeFeedback } from '../indexes.js';
import { computeWordFrequencies } from '../text-insights.js';
import { clearFilters } from '../filters.js';

let commentPage = 1;
let commentKeyword = '';
let commentSearch = '';
let showAllComments = false;

export function renderFeedback(app, { data, idx }) {
  const feedback = filterFeedback(data.feedback);
  const fm = feedbackMetrics(feedback);
  const distinct = dedupeFeedback(feedback);

  if (!distinct.length) {
    app.innerHTML = `
      <div class="page-header"><h2>Feedback</h2><p>Learner satisfaction and qualitative insights</p></div>
      <div class="empty-state"><h3>No feedback matches these filters</h3>
        <button type="button" class="btn btn-primary" id="empty-clear">Clear all filters</button></div>`;
    app.querySelector('#empty-clear')?.addEventListener('click', clearFilters);
    return;
  }

  const byType = new Map();
  for (const r of distinct) {
    const t = r.activity_type || 'Unknown';
    if (!byType.has(t)) byType.set(t, []);
    byType.get(t).push(r);
  }

  const byCourse = new Map();
  for (const r of distinct) {
    if (!r.course_id) continue;
    if (!byCourse.has(r.course_id)) byCourse.set(r.course_id, []);
    byCourse.get(r.course_id).push(r);
  }
  const courseBars = [...byCourse.entries()]
    .map(([id, rows]) => {
      const valid = rows.filter((r) => r.overall_rating != null);
      const avg = valid.length ? valid.reduce((s, r) => s + Number(r.overall_rating), 0) / valid.length : 0;
      return { name: idx.courseName(id), avg, count: rows.length };
    })
    .filter((c) => c.count >= 3)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const byInstructor = new Map();
  for (const r of feedback) {
    if (!r.instructor_id) continue;
    if (!byInstructor.has(r.instructor_id)) byInstructor.set(r.instructor_id, []);
    byInstructor.get(r.instructor_id).push(r);
  }
  const instBars = [...byInstructor.entries()]
    .map(([id, rows]) => {
      const d = dedupeFeedback(rows);
      const valid = d.filter((r) => r.overall_rating != null);
      const avg = valid.length ? valid.reduce((s, r) => s + Number(r.overall_rating), 0) / valid.length : 0;
      return { name: idx.instructorName(id), avg, count: d.length };
    })
    .filter((c) => c.count >= 5)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const wordFreq = computeWordFrequencies(feedback);
  const commentsPct = fm.distinctCount
    ? Math.round((wordFreq.afterJunkFilter / fm.distinctCount) * 100)
    : 0;

  let filteredComments = feedback;
  if (commentSearch) {
    const q = commentSearch.toLowerCase();
    filteredComments = filteredComments.filter((c) => String(c.student_comment).toLowerCase().includes(q));
  }
  if (commentKeyword) {
    filteredComments = filteredComments.filter((c) => String(c.student_comment).toLowerCase().includes(commentKeyword.toLowerCase()));
  }
  const comments = renderComments(filteredComments, commentPage, 15, {
    keyword: commentKeyword,
    substantiveOnly: !showAllComments,
  });

  const questions = perQuestionBreakdown(feedback);

  app.innerHTML = `
    <div class="page-header">
      <h2>Feedback</h2>
      <p>${fmt(fm.distinctCount, 'int')} distinct responses · COUNT(DISTINCT feedback_id)</p>
    </div>
    ${renderKpiRow([
      { label: 'Distinct Responses', value: fmt(fm.distinctCount, 'int') },
      { label: 'Avg Satisfaction', value: fmtAvg(fm.avgSatisfaction ? fm.avgSatisfaction * fm.satDenom : 0, fm.satDenom).value, sub: fmtAvg(0, fm.satDenom).sub },
      { label: 'NPS', value: fm.nps != null ? fmt(fm.nps, 'number') : '—', sub: `Promoters ${fm.promoters} · Detractors ${fm.detractors}` },
      { label: 'Comments', value: fmt(wordFreq.afterJunkFilter, 'int'), sub: `${commentsPct}% of responses are substantive` },
    ])}
    <div class="chart-grid">
      ${renderChartCard('fb-trend', 'Satisfaction Trend', 'Monthly average from distinct responses', 8)}
      ${renderChartCard('fb-dist', 'Rating Distribution', '', 4)}
      ${renderChartCard('fb-type', 'Internal vs External', 'Distinct responses by activity type', 4)}
      ${renderChartCard('fb-questions', 'Per-Question Breakdown', 'Six rating dimensions (1–5 scale)', 8)}
      ${renderChartCard('fb-course', 'By Course', 'Top 10 by response volume', 6)}
      ${renderChartCard('fb-inst', 'By Instructor', 'Top 10 by response volume (min 5)', 6)}
    </div>
    ${renderWordFrequencyPanel(wordFreq, { activeKeyword: commentKeyword })}
    <div class="section comments-panel">
      <h3>Student Comments</h3>
      ${commentKeyword ? `<p class="note-box">Filtered by keyword: <strong>${commentKeyword}</strong> <button type="button" class="btn btn-sm btn-ghost" id="clear-kw">Clear keyword</button></p>` : ''}
      ${renderTableCard({
        toolbar: `<input type="search" class="search-input" id="comment-search" placeholder="Search comments…" value="${commentSearch}">`,
        tableHtml: comments.html.replace('comments-list', 'comments-list'),
        footer: `<span>${comments.total.toLocaleString()} comments</span>
          <div class="pagination">Page ${comments.page} of ${comments.pages}
            <button class="btn btn-sm" id="cp-prev" ${comments.page <= 1 ? 'disabled' : ''}>Prev</button>
            <button class="btn btn-sm" id="cp-next" ${comments.page >= comments.pages ? 'disabled' : ''}>Next</button>
          </div>`,
      })}
    </div>
  `;

  const sat = satisfactionTrend(feedback);
  if (sat.length) {
    renderLineChart(document.getElementById('fb-trend'), {
      categories: sat.map((s) => s.month),
      series: [{ name: 'Avg Satisfaction', data: sat.map((s) => Number(s.avg.toFixed(2))), color: colorFor('DIPLOMA') }],
    });
  }

  const dist = ratingDistribution(feedback);
  renderBarChart(document.getElementById('fb-dist'), {
    categories: dist.map((d) => String(d.rating)),
    series: [{ name: 'Responses', data: dist.map((d) => d.count), color: colorFor('EXTERNAL') }],
  });

  const typeData = [...byType.entries()].map(([t, rows]) => ({
    name: activityTypeLabel(t),
    value: dedupeFeedback(rows).length,
    activityType: t,
  }));
  if (typeData.length) {
    renderDonut(document.getElementById('fb-type'), { data: typeData });
  }

  if (questions.some((q) => q.avg != null)) {
    renderGroupedBarChart(document.getElementById('fb-questions'), {
      categories: questions.map((q) => q.label),
      series: [{ name: 'Avg Score', data: questions.map((q) => (q.avg != null ? Number(q.avg.toFixed(2)) : null)), color: colorFor('INTERNAL') }],
    });
  }

  if (courseBars.length) {
    renderBarChart(document.getElementById('fb-course'), {
      categories: courseBars.map((c) => c.name.slice(0, 28)),
      series: [{ name: 'Avg Rating', data: courseBars.map((c) => Number(c.avg.toFixed(2))), color: colorFor('DIPLOMA') }],
      horizontal: true,
    });
  } else {
    document.getElementById('fb-course').innerHTML = renderCardEmpty();
  }

  if (instBars.length) {
    renderBarChart(document.getElementById('fb-inst'), {
      categories: instBars.map((c) => c.name),
      series: [{ name: 'Avg Rating', data: instBars.map((c) => Number(c.avg.toFixed(2))), color: colorFor('EXTERNAL') }],
      horizontal: true,
    });
  } else {
    document.getElementById('fb-inst').innerHTML = renderCardEmpty();
  }

  bindCommentsToggle(app, (all) => {
    showAllComments = all;
    commentPage = 1;
    renderFeedback(app, { data, idx });
  });
  app.querySelectorAll('.word-tag').forEach((btn) => {
    btn.addEventListener('click', () => {
      const w = btn.dataset.word;
      commentKeyword = commentKeyword === w ? '' : w;
      commentPage = 1;
      renderFeedback(app, { data, idx });
    });
  });
  app.querySelector('#clear-kw')?.addEventListener('click', () => { commentKeyword = ''; commentPage = 1; renderFeedback(app, { data, idx }); });
  app.querySelector('#comment-search')?.addEventListener('input', (e) => { commentSearch = e.target.value; commentPage = 1; renderFeedback(app, { data, idx }); });
  app.querySelector('#cp-prev')?.addEventListener('click', () => { if (commentPage > 1) { commentPage--; renderFeedback(app, { data, idx }); } });
  app.querySelector('#cp-next')?.addEventListener('click', () => { if (commentPage < comments.pages) { commentPage++; renderFeedback(app, { data, idx }); } });
}
