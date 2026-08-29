import {
  filterFeedback, feedbackMetrics, satisfactionTrend, ratingDistribution,
  npsDistribution, perQuestionBreakdown, fmt, fmtAvg,
} from '../metrics.js';
import { renderKpiGrid, renderChartCard, renderComments, paginate } from '../components.js';
import { renderLineChart, renderBarChart, renderDonut, COLORS } from '../charts.js';
import { activityTypeLabel } from '../format.js';
import { dedupeFeedback } from '../indexes.js';

let commentPage = 1;

export function renderFeedback(app, { data, idx }) {
  const feedback = filterFeedback(data.feedback);
  const fm = feedbackMetrics(feedback);
  const distinct = dedupeFeedback(feedback);

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
      const valid = rows.filter((r) => r.overall_satisfaction != null);
      const avg = valid.length ? valid.reduce((s, r) => s + Number(r.overall_satisfaction), 0) / valid.length : 0;
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
      const valid = d.filter((r) => r.overall_satisfaction != null);
      const avg = valid.length ? valid.reduce((s, r) => s + Number(r.overall_satisfaction), 0) / valid.length : 0;
      return { name: idx.instructorName(id), avg, count: d.length };
    })
    .filter((c) => c.count >= 5)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const comments = renderComments(feedback, commentPage, 15);
  const nps = npsDistribution(feedback);
  const questions = perQuestionBreakdown(feedback);

  app.innerHTML = `
    <div class="page-header"><h2>Feedback</h2><p>Distinct response analytics · ${fmt(fm.distinctCount, 'int')} responses</p></div>
    ${renderKpiGrid([
      { label: 'Total Responses', value: fmt(fm.distinctCount, 'int'), sub: 'COUNT(DISTINCT feedback_id)' },
      { label: 'Avg Satisfaction', value: fmtAvg(fm.avgSatisfaction ? fm.avgSatisfaction * fm.satDenom : 0, fm.satDenom).value, sub: fmtAvg(0, fm.satDenom).sub },
      { label: 'NPS', value: fm.nps != null ? fmt(fm.nps, 'number') : '—', sub: `Promoters ${fm.promoters} · Detractors ${fm.detractors}` },
      { label: 'Passives', value: fmt(fm.passives, 'int') },
    ])}
    <div class="chart-grid">
      ${renderChartCard('fb-trend', 'Satisfaction Trend')}
      ${renderChartCard('fb-dist', 'Rating Distribution')}
      ${renderChartCard('fb-type', 'Internal vs External')}
      ${renderChartCard('fb-course', 'By Course (top 10)')}
      ${renderChartCard('fb-inst', 'By Instructor (top 10)')}
      ${renderChartCard('fb-questions', 'Per-Question Breakdown')}
      ${renderChartCard('fb-nps', 'NPS Distribution')}
    </div>
    <div class="section"><h3>Student Comments</h3>
      ${comments.html}
      <div class="pagination">Page ${comments.page} of ${comments.pages} (${comments.total} comments)
        <button class="btn" id="cp-prev">Prev</button><button class="btn" id="cp-next">Next</button>
      </div>
    </div>
  `;

  const sat = satisfactionTrend(feedback);
  renderLineChart(document.getElementById('fb-trend'), {
    categories: sat.map((s) => s.month),
    series: [{ name: 'Avg', data: sat.map((s) => Number(s.avg.toFixed(2))), color: COLORS.completed }],
  });

  const dist = ratingDistribution(feedback);
  renderBarChart(document.getElementById('fb-dist'), {
    categories: dist.map((d) => String(d.rating)),
    series: [{ name: 'Responses', data: dist.map((d) => d.count), color: COLORS.primary }],
  });

  renderDonut(document.getElementById('fb-type'), {
    data: [...byType.entries()].map(([t, rows]) => ({
      name: activityTypeLabel(t),
      value: dedupeFeedback(rows).length,
    })),
  });

  renderBarChart(document.getElementById('fb-course'), {
    categories: courseBars.map((c) => c.name.slice(0, 25)),
    series: [{ name: 'Avg Rating', data: courseBars.map((c) => Number(c.avg.toFixed(2))), color: COLORS.secondary }],
    horizontal: true,
  });

  renderBarChart(document.getElementById('fb-inst'), {
    categories: instBars.map((c) => c.name),
    series: [{ name: 'Avg Rating', data: instBars.map((c) => Number(c.avg.toFixed(2))), color: COLORS.primary }],
    horizontal: true,
  });

  renderBarChart(document.getElementById('fb-questions'), {
    categories: questions.map((q) => q.label),
    series: [{ name: 'Avg', data: questions.map((q) => q.avg != null ? Number(q.avg.toFixed(2)) : 0), color: COLORS.planned }],
  });

  renderDonut(document.getElementById('fb-nps'), {
    data: [
      { name: 'Promoter', value: nps.promoter },
      { name: 'Passive', value: nps.passive },
      { name: 'Detractor', value: nps.detractor },
    ],
  });

  app.querySelector('#cp-prev')?.addEventListener('click', () => { if (commentPage > 1) { commentPage--; renderFeedback(app, { data, idx }); } });
  app.querySelector('#cp-next')?.addEventListener('click', () => { if (commentPage < comments.pages) { commentPage++; renderFeedback(app, { data, idx }); } });
}
