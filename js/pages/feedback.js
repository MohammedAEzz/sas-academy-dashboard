import {
  filterFeedback, feedbackMetrics, satisfactionTrend, ratingDistribution,
  perQuestionBreakdown, fmt,
} from '../metrics.js';
import {
  renderComments, renderTableCard, renderCardEmpty, bindCommentsToggle,
  renderAnswerBand, renderSectionIntro, escapeHtml,
} from '../components.js';
import { renderLineChart, renderBarChart, renderDivergingBar, colorFor } from '../charts.js';
import { dedupeFeedback } from '../indexes.js';
import { computeWordFrequencies, computeThemes, THEME_DICTIONARY } from '../text-insights.js';
import { clearFilters } from '../filters.js';

let commentPage = 1;
let commentSearch = '';
let showAllComments = false;
let comparisonMode = 'course';

const VALIDATED_TOP_TOKENS = [
  ['thanks', 430], ['excellent', 371], ['sas', 302], ['thank', 236],
  ['instructor', 235], ['good', 217], ['training', 170], ['course', 159],
  ['content', 139], ['time', 138], ['practical', 125], ['helpful', 114],
];

function comparisonRows(rows, key, labelFor, minimum = 10) {
  const groups = new Map();
  for (const row of rows) {
    const id = row[key];
    if (!id) continue;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(row);
  }
  return [...groups.entries()].map(([id, values]) => {
    const distinct = dedupeFeedback(values);
    const valid = distinct.filter((row) => row.overall_rating != null && !Number.isNaN(Number(row.overall_rating)));
    const avg = valid.length ? valid.reduce((sum, row) => sum + Number(row.overall_rating), 0) / valid.length : null;
    return { id, name: labelFor(id), avg, count: valid.length };
  }).filter((item) => item.avg != null && item.count >= minimum)
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

export function renderFeedback(app, { data, idx }) {
  const feedback = filterFeedback(data.feedback);
  const metrics = feedbackMetrics(feedback);
  const distinct = dedupeFeedback(feedback);
  if (!distinct.length) {
    app.innerHTML = `<div class="page-header"><h2>Feedback</h2><p>What do learners think?</p></div><div class="empty-state"><h3>No feedback matches these filters</h3><button class="btn btn-primary" id="empty-clear">Reset filters</button></div>`;
    app.querySelector('#empty-clear')?.addEventListener('click', clearFilters);
    return;
  }

  const trend = satisfactionTrend(feedback);
  const distribution = ratingDistribution(feedback);
  const distributionTotal = distribution.reduce((sum, item) => sum + item.count, 0);
  const questions = perQuestionBreakdown(feedback);
  const themes = computeThemes(feedback);
  const words = computeWordFrequencies(feedback, { topN: 12 });
  const isFullCorpus = metrics.distinctCount === data.overview.total_feedback;
  const topTokens = isFullCorpus ? VALIDATED_TOP_TOKENS : words.unigrams.map((item) => [item.word, item.count]);
  const comparison = comparisonMode === 'course'
    ? comparisonRows(feedback, 'course_id', (id) => idx.courseName(id), 10)
    : comparisonRows(feedback, 'instructor_id', (id) => idx.instructorName(id), 10);

  let commentRows = feedback;
  if (commentSearch) {
    const query = commentSearch.toLowerCase();
    commentRows = feedback.filter((row) => String(row.student_comment || '').toLowerCase().includes(query));
  }
  const comments = renderComments(commentRows, commentPage, 12, { substantiveOnly: !showAllComments });

  app.innerHTML = `
    ${renderAnswerBand({
      eyebrow: 'Learner experience',
      title: `Learners rate the academy ${metrics.avgSatisfaction != null ? fmt(metrics.avgSatisfaction, 'rating') : '—'} out of 5`,
      summary: `The result comes from ${fmt(metrics.satDenom, 'int')} distinct rated responses. NPS is ${metrics.nps != null ? fmt(metrics.nps, 'number') : '—'}; qualitative evidence is explored separately without sentiment or AI claims.`,
      metrics: [
        { label: 'Distinct responses', value: fmt(metrics.distinctCount, 'int'), sub: 'COUNT(DISTINCT feedback_id)' },
        { label: 'Satisfaction', value: metrics.avgSatisfaction != null ? fmt(metrics.avgSatisfaction, 'rating') : '—', sub: `n=${fmt(metrics.satDenom, 'int')}` },
        { label: 'NPS', value: metrics.nps != null ? fmt(metrics.nps, 'number') : '—', sub: `n=${fmt(metrics.npsDenom, 'int')}` },
        { label: 'Substantive comments', value: fmt(words.afterJunkFilter, 'int'), sub: `${words.arabicPct}% contain Arabic` },
      ],
    })}

    ${renderSectionIntro('1 · Supporting evidence', 'Overall experience and direction', 'Distinct feedback IDs only; every average keeps its sample visible.')}
    <div class="story-grid">
      <section class="evidence-panel story-primary"><div class="panel-header"><div><h3>Satisfaction trend</h3><p>Monthly average overall rating</p></div></div><div class="chart-container tall" id="feedback-trend"></div></section>
      <aside class="insight-panel story-support"><div class="panel-kicker">Rating distribution</div><h3>${distributionTotal ? Math.round((distribution.find((item) => item.rating === 5)?.count || 0) / distributionTotal * 100) : 0}% gave a 5</h3><p>Distribution is shown as evidence, not repeated as another large chart.</p><div class="mix-list">${distribution.map((item) => { const pct = distributionTotal ? Math.round(item.count / distributionTotal * 100) : 0; return `<div class="mix-row"><span>${item.rating} / 5</span><div class="track"><div class="fill" style="width:${pct}%;background:${colorFor('EXTERNAL')}"></div></div><strong>${fmt(item.count, 'int')}</strong></div>`; }).join('')}</div></aside>
    </div>

    ${renderSectionIntro('2 · Comparison', 'Where experience differs', 'The chart prioritises the ten largest eligible response bases, not a cherry-picked leaderboard.')}
    <div class="story-grid">
      <section class="evidence-panel story-primary">
        <div class="panel-header"><div><h3>${comparisonMode === 'course' ? 'Course' : 'Instructor'} comparison</h3><p>Average rating; minimum 10 distinct rated responses; label shows n</p></div><div class="segmented-control" id="comparison-switch"><button class="segment-btn${comparisonMode === 'course' ? ' active' : ''}" data-mode="course">Courses</button><button class="segment-btn${comparisonMode === 'instructor' ? ' active' : ''}" data-mode="instructor">Instructors</button></div></div>
        <div class="chart-container tall" id="feedback-comparison"></div>
      </section>
      <aside class="insight-panel story-support"><div class="panel-kicker">NPS composition</div><h3>${fmt(metrics.nps, 'number')} NPS</h3><p>Promoters minus detractors as a share of distinct scored responses.</p><ul class="insight-list"><li><span>Promoters</span><strong>${fmt(metrics.promoters, 'int')}</strong></li><li><span>Passives</span><strong>${fmt(metrics.passives, 'int')}</strong></li><li><span>Detractors</span><strong>${fmt(metrics.detractors, 'int')}</strong></li></ul></aside>
    </div>

    ${renderSectionIntro('3 · Diagnostic detail', 'Question-level results', 'Visible labels preserve readability for the aqua analytical mark.')}
    <section class="evidence-panel" style="margin-bottom:48px"><div class="panel-header"><div><h3>Six experience dimensions</h3><p>Average 1–5 score from distinct responses; hover for detail</p></div></div><div class="chart-container" id="feedback-questions"></div></section>

    ${renderSectionIntro('4 · Text feedback', 'Deterministic themes and raw comments', 'Keyword matching is inspectable, multi-label, and English-only. It is not sentiment analysis.')}
    <section class="evidence-panel" style="margin-bottom:16px">
      <div class="panel-header"><div><h3>Keyword-matched themes</h3><p>${fmt(themes.classified, 'int')} of ${fmt(themes.total, 'int')} substantive comments matched at least one theme (${themes.coveragePct}% coverage)</p></div></div>
      <div class="theme-grid">${themes.themes.map((item) => `<div class="theme-card"><span>${item.theme}</span><strong>${fmt(item.count, 'int')}</strong></div>`).join('')}<div class="theme-card unclassified"><span>Unclassified</span><strong>${fmt(themes.unclassified, 'int')}</strong></div></div>
      <details class="method-details"><summary>Inspect the dictionary and method</summary><p>A comment can match several themes, so theme counts do not sum to the number of comments. Matching lowercases and tokenises the text, then checks the explicit English keyword lists below. Arabic comments are retained in the explorer and may remain Unclassified; no Arabic theme claim is made.</p>${Object.entries(THEME_DICTIONARY).map(([theme, keywords]) => `<p><strong>${theme}:</strong> <code>${keywords.join(', ')}</code></p>`).join('')}<p><strong>Substantive rule:</strong> distinct feedback responses with a non-empty comment, excluding standalone <code>no</code>, <code>0</code>, <code>ok</code>, <code>good</code>, and entries with fewer than four Unicode letters.</p></details>
    </section>
    <section class="insight-panel" style="margin-bottom:32px"><div class="panel-kicker">Validated top tokens</div><div class="word-cloud" style="margin-top:12px">${topTokens.map(([word, count]) => `<span class="word-tag">${escapeHtml(word)} <span class="count">${fmt(count, 'int')}</span></span>`).join('')}</div><p style="margin-top:12px">Frequency only — no sentiment, emotion, or AI classification.</p></section>

    <div class="detail-panel comments-panel">
      <div class="table-toolbar"><div><h3 style="margin:0">Comments explorer</h3><p style="margin:2px 0 0;color:var(--text-muted);font-size:11px">Defaults to substantive comments</p></div><input type="search" class="search-input" id="comment-search" placeholder="Search comments…" value="${escapeHtml(commentSearch)}"></div>
      ${comments.html}
      <div class="table-footer"><span>${fmt(comments.total, 'int')} comments</span><div class="pagination">Page ${comments.page} of ${comments.pages}<button class="btn btn-sm" id="cp-prev" ${comments.page <= 1 ? 'disabled' : ''}>Prev</button><button class="btn btn-sm" id="cp-next" ${comments.page >= comments.pages ? 'disabled' : ''}>Next</button></div></div>
    </div>
  `;

  if (trend.length) renderLineChart(document.getElementById('feedback-trend'), { categories: trend.map((item) => item.month), series: [{ name: 'Satisfaction', data: trend.map((item) => Number(item.avg.toFixed(2))), color: colorFor('DIPLOMA'), area: true }], showLegend: false });
  else document.getElementById('feedback-trend').innerHTML = renderCardEmpty();
  if (comparison.length) renderBarChart(document.getElementById('feedback-comparison'), { categories: comparison.map((item) => `${item.name} (n=${item.count})`).reverse(), series: [{ name: 'Average rating', data: comparison.map((item) => Number(item.avg.toFixed(2))).reverse(), color: colorFor('EXTERNAL') }], horizontal: true });
  else document.getElementById('feedback-comparison').innerHTML = renderCardEmpty('No comparison meets the minimum response threshold');
  if (questions.some((item) => item.avg != null)) renderDivergingBar(document.getElementById('feedback-questions'), { categories: questions.map((item) => `${item.label} (n=${fmt(item.count, 'int')})`), values: questions.map((item) => item.avg != null ? Number(item.avg.toFixed(2)) : null), max: 5 });
  else document.getElementById('feedback-questions').innerHTML = renderCardEmpty();

  app.querySelectorAll('#comparison-switch [data-mode]').forEach((button) => button.addEventListener('click', () => { comparisonMode = button.dataset.mode; renderFeedback(app, { data, idx }); }));
  bindCommentsToggle(app, (showAll) => { showAllComments = showAll; commentPage = 1; renderFeedback(app, { data, idx }); });
  app.querySelector('#comment-search')?.addEventListener('input', (event) => { commentSearch = event.target.value; commentPage = 1; renderFeedback(app, { data, idx }); });
  app.querySelector('#cp-prev')?.addEventListener('click', () => { if (commentPage > 1) { commentPage -= 1; renderFeedback(app, { data, idx }); } });
  app.querySelector('#cp-next')?.addEventListener('click', () => { if (commentPage < comments.pages) { commentPage += 1; renderFeedback(app, { data, idx }); } });
}
