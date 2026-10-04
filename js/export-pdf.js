/**
 * Presentation: turn a report model into a downloadable A4 PDF.
 * Libraries and the Latin font are loaded only when an export starts.
 */
import { buildChartOption, withExportCharts } from './charts.js';
import { ARABIC, buildReport } from './domain/report-model.js';

const MARGIN_X = 14;
const MARGIN_TOP = 18;
const MARGIN_BOTTOM = 16;
const NAVY = [11, 47, 91];
const INK = [11, 11, 11];
const MUTED = [82, 81, 78];
const RULE = [229, 228, 224];
const ZEBRA = [238, 245, 253];
const WHITE = [255, 255, 255];
const LATIN_FONT = 'NotoSans';
// Amiri covers Arabic (including the joined presentation forms jsPDF shapes into) and Latin,
// so a mixed Arabic/English string can be drawn in one font.
const ARABIC_FONT = 'Amiri';
// Logical (typed) order in, visual order out, right-to-left paragraph, mirrored brackets.
const RTL_TEXT_OPTIONS = {
  isInputVisual: false,
  isOutputVisual: true,
  isInputRtl: true,
  isOutputRtl: false,
  isSymmetricSwapping: true,
};

let librariesPromise = null;
let arabicFontsPromise = null;

function hasArabic(value) {
  return ARABIC.test(Array.isArray(value) ? value.join(' ') : String(value ?? ''));
}

function fontFor(text) {
  return hasArabic(text) ? ARABIC_FONT : LATIN_FONT;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-pdf-src="${src}"]`);
    if (existing?.dataset.loaded === '1') {
      resolve();
      return;
    }
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Could not load the PDF library.')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.dataset.pdfSrc = src;
    script.onload = () => {
      script.dataset.loaded = '1';
      resolve();
    };
    script.onerror = () => reject(new Error('Could not load the PDF library.'));
    document.head.appendChild(script);
  });
}

async function ensureLibraries() {
  if (!librariesPromise) {
    librariesPromise = (async () => {
      await loadScript('/assets/jspdf.umd.min.js');
      await loadScript('/assets/jspdf.plugin.autotable.min.js');
      const [regular, bold] = await Promise.all([
        fetch('/assets/NotoSans-Regular.ttf').then((response) => {
          if (!response.ok) throw new Error('Could not load the report font.');
          return response.arrayBuffer();
        }),
        fetch('/assets/NotoSans-Bold.ttf').then((response) => {
          if (!response.ok) throw new Error('Could not load the report font.');
          return response.arrayBuffer();
        }),
      ]);
      return { regular: toBase64(regular), bold: toBase64(bold) };
    })().catch((error) => {
      librariesPromise = null;
      throw error;
    });
  }
  return librariesPromise;
}

async function fetchFont(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error('Could not load the report font.');
  return toBase64(await response.arrayBuffer());
}

/** The Arabic font (~0.8 MB) is downloaded only for reports that contain Arabic text. */
function ensureArabicFonts() {
  if (!arabicFontsPromise) {
    arabicFontsPromise = Promise.all([
      fetchFont('/assets/Amiri-Regular.ttf'),
      fetchFont('/assets/Amiri-Bold.ttf'),
    ]).then(([regular, bold]) => ({ regular, bold })).catch((error) => {
      arabicFontsPromise = null;
      throw error;
    });
  }
  return arabicFontsPromise;
}

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

function chartPixelSize(item) {
  const count = item.spec?.categories?.length || 8;
  if (item.kind === 'diverging' || (item.kind === 'bar' && item.spec?.horizontal)) {
    return { width: 860, height: Math.max(430, Math.min(800, 130 + count * 38)) };
  }
  // A small CSS canvas keeps ECharts' fixed-px labels legible once scaled to the A4 text width.
  return { width: 860, height: 430 };
}

function chartToPng(item) {
  if (!window.echarts) throw new Error('Charts are not available yet.');
  const { width, height } = chartPixelSize(item);
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = `position:fixed;left:-20000px;top:0;width:${width}px;height:${height}px;pointer-events:none;`;
  document.body.appendChild(host);
  let chart = null;
  try {
    return withExportCharts(() => {
      chart = window.echarts.init(host, null, { renderer: 'canvas', devicePixelRatio: 3, width, height });
      const option = buildChartOption(item.kind, item.spec);
      chart.setOption({ ...option, animation: false });
      chart.resize({ width, height });
      return chart.getDataURL({ type: 'png', pixelRatio: 3, backgroundColor: '#fcfcfb' });
    });
  } finally {
    chart?.dispose();
    host.remove();
  }
}

function createDocument(fonts, arabicFonts) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  doc.addFileToVFS('NotoSans-Regular.ttf', fonts.regular);
  doc.addFileToVFS('NotoSans-Bold.ttf', fonts.bold);
  doc.addFont('NotoSans-Regular.ttf', LATIN_FONT, 'normal');
  doc.addFont('NotoSans-Bold.ttf', LATIN_FONT, 'bold');
  if (arabicFonts) {
    doc.addFileToVFS('Amiri-Regular.ttf', arabicFonts.regular);
    doc.addFileToVFS('Amiri-Bold.ttf', arabicFonts.bold);
    doc.addFont('Amiri-Regular.ttf', ARABIC_FONT, 'normal');
    doc.addFont('Amiri-Bold.ttf', ARABIC_FONT, 'bold');
    useRtlLayoutForArabic(doc);
  }
  doc.setFont(LATIN_FONT, 'normal');
  return doc;
}

/**
 * Every string reaches the page through doc.text (ours and jspdf-autotable's). jsPDF already
 * shapes Arabic letters; here Arabic strings also get right-to-left bidi reordering.
 */
function useRtlLayoutForArabic(doc) {
  const drawText = doc.text;
  doc.text = function textWithRtl(text, x, y, options, ...rest) {
    const rtl = hasArabic(text) ? { ...(options || {}), ...RTL_TEXT_OPTIONS } : options;
    return drawText.call(this, text, x, y, rtl, ...rest);
  };
}

/** Draw one line, right-aligned in the Arabic font when it contains Arabic. */
function drawLine(doc, line, y, style) {
  if (hasArabic(line)) {
    doc.setFont(ARABIC_FONT, style);
    doc.text(line, doc.internal.pageSize.getWidth() - MARGIN_X, y, { align: 'right' });
    doc.setFont(LATIN_FONT, style);
    return;
  }
  doc.text(line, MARGIN_X, y);
}

function contentWidth(doc) {
  return doc.internal.pageSize.getWidth() - MARGIN_X * 2;
}

function pageBottom(doc) {
  return doc.internal.pageSize.getHeight() - MARGIN_BOTTOM;
}

function addPage(doc, orientation, cursor) {
  doc.addPage('a4', orientation);
  cursor.y = MARGIN_TOP;
  cursor.orientation = orientation;
}

function ensure(doc, cursor, height) {
  if (cursor.y + height <= pageBottom(doc)) return;
  addPage(doc, cursor.orientation, cursor);
}

function writeLines(doc, cursor, lines, { size = 11, color = INK, style = 'normal', gap = 4.6 } = {}) {
  doc.setFont(LATIN_FONT, style);
  doc.setFontSize(size);
  doc.setTextColor(...color);
  for (const line of lines) {
    ensure(doc, cursor, gap + 1);
    drawLine(doc, line, cursor.y, style);
    cursor.y += gap;
  }
}

function paragraph(doc, cursor, text, options = {}) {
  const width = contentWidth(doc);
  const value = String(text || '');
  doc.setFont(fontFor(value), options.style || 'normal');
  doc.setFontSize(options.size || 11);
  const lines = doc.splitTextToSize(value, width);
  writeLines(doc, cursor, lines, options);
}

function heading(doc, cursor, text, level = 1) {
  const size = level === 1 ? 16 : 13;
  const gap = level === 1 ? 8 : 6.5;
  if (cursor.y > MARGIN_TOP + 1) cursor.y += level === 1 ? 5 : 3.5;
  ensure(doc, cursor, gap + 4);
  doc.setFont(fontFor(text), 'bold');
  doc.setFontSize(size);
  doc.setTextColor(...NAVY);
  const lines = doc.splitTextToSize(text, contentWidth(doc));
  doc.setFont(LATIN_FONT, 'bold');
  for (const line of lines) {
    drawLine(doc, line, cursor.y, 'bold');
    cursor.y += gap;
  }
  doc.setDrawColor(42, 120, 214);
  doc.setLineWidth(0.4);
  doc.line(MARGIN_X, cursor.y - 2, MARGIN_X + Math.min(48, contentWidth(doc)), cursor.y - 2);
  cursor.y += 3;
}

const SHORT_CELL_CHARS = 14;
const CELL_PADDING_MM = 3.4;
const LONG_COLUMN_MIN_MM = 40;

function unbreakableColumnWidths(doc, item, fontSize) {
  doc.setFont('NotoSans', 'normal');
  doc.setFontSize(fontSize);
  const styles = {};
  item.head.forEach((title, column) => {
    const cells = item.body.map((row) => String(row[column] ?? ''));
    if (!cells.length) return;
    const widest = Math.max(...cells.map((cell) => doc.getTextWidth(cell)));
    if (cells.some((cell) => cell.length > SHORT_CELL_CHARS)) {
      // Long text may wrap, but not into a sliver beside one greedy column.
      styles[column] = { minCellWidth: Math.min(widest + CELL_PADDING_MM, LONG_COLUMN_MIN_MM) };
      return;
    }
    doc.setFont('NotoSans', 'bold');
    const header = Math.max(...String(title).split(/\s+/).map((word) => doc.getTextWidth(word)));
    doc.setFont('NotoSans', 'normal');
    styles[column] = { minCellWidth: Math.max(widest, header) + CELL_PADDING_MM };
  });
  return styles;
}

function drawTable(doc, cursor, item) {
  const wide = item.head.length >= 7;
  if (wide && cursor.orientation !== 'landscape') {
    addPage(doc, 'landscape', cursor);
  } else if (!wide && cursor.orientation !== 'portrait') {
    addPage(doc, 'portrait', cursor);
  }
  heading(doc, cursor, item.title, 2);
  const fontSize = wide ? 8 : 9;
  doc.autoTable({
    columnStyles: unbreakableColumnWidths(doc, item, fontSize),
    startY: cursor.y,
    margin: { top: MARGIN_TOP, right: MARGIN_X, bottom: MARGIN_BOTTOM, left: MARGIN_X },
    head: [item.head],
    body: item.body.length ? item.body : [item.head.map(() => '—')],
    showHead: 'everyPage',
    rowPageBreak: 'auto',
    styles: {
      font: 'NotoSans',
      fontStyle: 'normal',
      fontSize,
      textColor: INK,
      cellPadding: 1.6,
      overflow: 'linebreak',
      valign: 'top',
    },
    headStyles: {
      font: 'NotoSans',
      fontStyle: 'bold',
      fillColor: NAVY,
      textColor: WHITE,
      overflow: 'linebreak',
    },
    alternateRowStyles: { fillColor: ZEBRA },
    tableWidth: contentWidth(doc),
    didParseCell(hook) {
      if (!hasArabic(hook.cell.text)) return;
      hook.cell.styles.font = ARABIC_FONT;
      hook.cell.styles.halign = 'right';
    },
  });
  cursor.y = doc.lastAutoTable.finalY + 8;
}

function drawChart(doc, cursor, item) {
  const dataUrl = chartToPng(item);
  const props = doc.getImageProperties(dataUrl);
  const maxW = contentWidth(doc);
  const maxH = doc.internal.pageSize.getHeight() - MARGIN_TOP - MARGIN_BOTTOM - 14;
  let width = maxW;
  let height = width * (props.height / props.width);
  if (height > maxH) {
    height = maxH;
    width = height * (props.width / props.height);
  }
  const block = 6 + height + 8;
  if (cursor.y + block > pageBottom(doc)) addPage(doc, cursor.orientation, cursor);
  doc.setFont('NotoSans', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...NAVY);
  const titleLines = doc.splitTextToSize(item.title, maxW);
  for (const line of titleLines) {
    ensure(doc, cursor, 5);
    drawLine(doc, line, cursor.y, 'bold');
    cursor.y += 5;
  }
  const x = MARGIN_X + (maxW - width) / 2;
  doc.addImage(dataUrl, 'PNG', x, cursor.y, width, height);
  cursor.y += height + 4;
  doc.setFont('NotoSans', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  const caption = doc.splitTextToSize(item.caption || '', maxW);
  for (const line of caption) {
    ensure(doc, cursor, 4);
    drawLine(doc, line, cursor.y, 'normal');
    cursor.y += 4;
  }
  cursor.y += 4;
}

function drawCover(doc, cursor, model) {
  heading(doc, cursor, model.title, 1);
  paragraph(doc, cursor, 'Report generated at', { size: 9, style: 'bold', color: NAVY, gap: 4 });
  paragraph(doc, cursor, model.generatedAt, { size: 11, gap: 6 });
  paragraph(doc, cursor, 'Data last updated', { size: 9, style: 'bold', color: NAVY, gap: 4 });
  paragraph(doc, cursor, model.cover.dataUpdated, { size: 11, gap: 6 });
  paragraph(doc, cursor, 'Historical data as of', { size: 9, style: 'bold', color: NAVY, gap: 4 });
  paragraph(doc, cursor, model.cover.historicalAsOf, { size: 11, gap: 6 });
  paragraph(doc, cursor, 'Scope', { size: 9, style: 'bold', color: NAVY, gap: 4 });
  paragraph(doc, cursor, model.cover.scopeLabel, { size: 11, gap: 6 });
  paragraph(doc, cursor, 'Applied filters', { size: 9, style: 'bold', color: NAVY, gap: 4 });
  for (const filter of model.cover.filters) paragraph(doc, cursor, filter, { size: 11, gap: 5 });
  cursor.y += 4;
  heading(doc, cursor, 'Key metrics', 2);
  paragraph(doc, cursor, 'The same definitions the Overview page uses for completed sessions, planned sessions, completed hours, and distinct feedback.', { size: 10, color: MUTED, gap: 4.4 });
  drawTable(doc, cursor, {
    title: 'Overview KPIs',
    head: ['Metric', 'Value'],
    body: [
      ['Completed sessions', String(model.kpis.completedSessions)],
      ['Planned sessions', String(model.kpis.plannedSessions)],
      ['Completed hours', String(model.kpis.completedHours)],
      ['Distinct feedback', String(model.kpis.distinctFeedback)],
    ],
  });
}

function stampPages(doc, generatedAt) {
  const total = doc.getNumberOfPages();
  for (let page = 1; page <= total; page += 1) {
    doc.setPage(page);
    const width = doc.internal.pageSize.getWidth();
    const height = doc.internal.pageSize.getHeight();
    doc.setFillColor(...NAVY);
    doc.rect(0, 0, width, 10, 'F');
    doc.setFont('NotoSans', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...WHITE);
    doc.text('SAS Academy Analytics Report', MARGIN_X, 6.6);
    doc.setDrawColor(...RULE);
    doc.setLineWidth(0.2);
    doc.line(MARGIN_X, height - 11, width - MARGIN_X, height - 11);
    doc.setFont('NotoSans', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(generatedAt, MARGIN_X, height - 6);
    doc.text(`Page ${page} of ${total}`, width - MARGIN_X, height - 6, { align: 'right' });
  }
}

export async function downloadReportPdf({ data, idx, scope, filters, onProgress }) {
  onProgress?.('Loading PDF tools…');
  const fonts = await ensureLibraries();
  onProgress?.('Preparing the report…');
  const model = withExportCharts(() => buildReport({
    data,
    idx,
    scope,
    filters,
    generatedAt: new Date(),
  }));
  const arabicFonts = hasArabic(JSON.stringify(model)) ? await ensureArabicFonts() : null;
  const doc = createDocument(fonts, arabicFonts);
  const cursor = { y: MARGIN_TOP, orientation: 'portrait' };
  drawCover(doc, cursor, model);
  let drawn = 0;
  const chartCount = model.sections.reduce((sum, section) => sum + section.charts.length, 0);
  for (const section of model.sections) {
    if (cursor.orientation !== 'portrait') addPage(doc, 'portrait', cursor);
    heading(doc, cursor, section.title, 1);
    paragraph(doc, cursor, section.headline, { size: 12, style: 'bold', gap: 6 });
    paragraph(doc, cursor, section.summary, { size: 10, color: MUTED, gap: 4.4 });
    if (section.metrics?.length) {
      drawTable(doc, cursor, {
        title: 'Metrics',
        head: ['Metric', 'Value', 'Note'],
        body: section.metrics.map((entry) => [entry.label, entry.value, entry.sub || '—']),
      });
    }
    for (const item of section.charts) {
      drawn += 1;
      onProgress?.(`Drawing charts (${drawn} of ${chartCount})…`);
      if (cursor.orientation !== 'portrait') addPage(doc, 'portrait', cursor);
      drawChart(doc, cursor, item);
    }
    for (const item of section.tables.filter((entry) => !entry.appendix)) {
      onProgress?.(`Writing ${item.title}…`);
      drawTable(doc, cursor, item);
    }
    for (const note of section.notes || []) paragraph(doc, cursor, note, { size: 9, color: MUTED, gap: 4.2 });
    cursor.y += 2;
  }

  if (cursor.orientation !== 'portrait') addPage(doc, 'portrait', cursor);
  heading(doc, cursor, 'Data notes', 1);
  for (const note of model.dataNotes) paragraph(doc, cursor, note, { size: 10, gap: 5 });

  const appendix = model.sections.flatMap((section) => section.tables.filter((entry) => entry.appendix));
  if (appendix.length) {
    if (cursor.orientation !== 'portrait') addPage(doc, 'portrait', cursor);
    heading(doc, cursor, 'Appendix', 1);
    paragraph(doc, cursor, 'Tables longer than 300 rows are printed here in full, with the header repeated on every page.', { size: 10, color: MUTED, gap: 4.4 });
    for (const item of appendix) {
      onProgress?.(`Writing ${item.title}…`);
      drawTable(doc, cursor, item);
    }
  }

  stampPages(doc, model.generatedAt);
  onProgress?.('Saving the PDF…');
  doc.save(model.filename);
  return model;
}
