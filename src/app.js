const STORAGE_KEY = 'biobank-scan-inventory-state-v1';
const SAMPLE_ID_HEADERS = ['样本编号', '样本id', '编号', 'sample_id', 'sampleid', 'barcode', 'sample barcode', 'id'];
const SAMPLE_ID_HEADER_ALIASES = new Set([
  '样本编号',
  '样本id',
  '样本号码',
  '样本条码',
  '条码',
  '编号',
  'id',
  'sampleid',
  'samplebarcode',
  'barcode',
]);
const EXPORT_BASE_HEADERS = ['样本编号', '条码', '入库状态', '样本类型', '样本来源', '返回公司', '冰箱编号(001/002)', '层架序号(从上到下1-4)', '列序号(从左到右1-5)', '抽箱序号(每列从上到下1-5)', '格子序号(每抽箱从外到内1-5)', '盒号', '盒内位置', '扫码时间'];
const DEFAULT_BOX_CAPACITY = 12;

const state = {
  samples: new Map(),
  scanLog: [],
  boxCounter: 1,
  currentBoxPosition: 'A1',
  originalHeaders: [],
};

const elements = {};

function normaliseId(value) {
  return String(value ?? '').trim();
}

function normaliseHeader(value) {
  return normaliseId(value).toLowerCase().replace(/[\s_\-\/]+/g, '');
}

function normaliseSampleSource(sample = {}) {
  if (sample.sampleSource === '测序返回样本' || sample.isCompanyReturned === '是') return '测序返回样本';
  return sample.sampleSource || '原始采集样本';
}

function buildLocation() {
  return {
    freezer: elements.freezer.value,
    shelf: elements.shelf.value,
    column: elements.column.value,
    drawer: elements.drawer.value,
    cell: elements.cell.value,
  };
}

function formatLocation(location) {
  if (!location) return '';
  return `冰箱${location.freezer} / 从上到下第${location.shelf}层 / 从左到右第${location.column}列 / 从上到下第${location.drawer}抽箱 / 从外到内第${location.cell}格`;
}

function beep(type = 'error') {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const context = new AudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type === 'success' ? 'sine' : 'square';
  oscillator.frequency.value = type === 'success' ? 920 : 190;
  gain.gain.setValueAtTime(type === 'success' ? 0.08 : 0.12, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.22);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.22);
}

function serialiseState() {
  return {
    samples: Array.from(state.samples.values()),
    scanLog: state.scanLog,
    boxCounter: state.boxCounter,
    currentBoxPosition: state.currentBoxPosition,
    originalHeaders: state.originalHeaders,
  };
}

function persistState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(serialiseState()));
}

function restoreState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw);
    state.samples = new Map((parsed.samples || []).map((sample) => [sample.id, migrateSample(sample)]));
    state.scanLog = parsed.scanLog || [];
    state.boxCounter = parsed.boxCounter || 1;
    state.currentBoxPosition = parsed.currentBoxPosition || inferNextBoxPosition() || 'A1';
    state.originalHeaders = parsed.originalHeaders || [];
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function migrateSample(sample) {
  const sampleSource = normaliseSampleSource(sample);
  return {
    ...sample,
    barcode: sample.barcode || sample.id,
    originalData: sample.originalData || {},
    sampleType: sample.sampleType || '',
    sampleSource,
    returnCompany: sampleSource === '测序返回样本' ? sample.returnCompany || '' : '',
    boxPosition: sample.boxPosition || '',
  };
}

function addLog(level, message, sampleId = '') {
  state.scanLog.unshift({
    level,
    message,
    sampleId,
    time: new Date().toLocaleString('zh-CN', { hour12: false }),
  });
  state.scanLog = state.scanLog.slice(0, 300);
}

function getCurrentBoxName() {
  const typed = normaliseId(elements.boxName.value);
  return typed || `BOX-${String(state.boxCounter).padStart(3, '0')}`;
}

function getCurrentBoxStoredCount() {
  const boxName = getCurrentBoxName();
  return Array.from(state.samples.values()).filter((sample) => sample.status === '已入库' && sample.boxName === boxName).length;
}

function updateBoxSummary() {
  if (!elements.currentBoxCount || !elements.positionPreview) return;
  elements.currentBoxCount.textContent = getCurrentBoxStoredCount();
  elements.positionPreview.textContent = normaliseId(elements.boxPosition.value) || state.currentBoxPosition || 'A1';
}

function updateStats() {
  const samples = Array.from(state.samples.values());
  const stored = samples.filter((sample) => sample.status === '已入库').length;
  elements.totalCount.textContent = samples.length;
  elements.storedCount.textContent = stored;
  elements.pendingCount.textContent = samples.length - stored;
  elements.mismatchCount.textContent = state.scanLog.filter((item) => item.level === 'error').length;
  updateBoxSummary();
}

function renderTable() {
  const keyword = normaliseId(elements.searchInput.value).toLowerCase();
  const samples = Array.from(state.samples.values()).filter((sample) => sample.id.toLowerCase().includes(keyword));
  if (!samples.length) {
    elements.sampleTable.innerHTML = `<tr><td colspan="9" class="empty">${state.samples.size ? '没有符合搜索条件的样本。' : '请上传样本清单。'}</td></tr>`;
    return;
  }
  elements.sampleTable.innerHTML = samples.map((sample) => `
    <tr class="${sample.status === '已入库' ? 'is-stored' : ''}">
      <td><strong>${escapeHtml(sample.id)}</strong></td>
      <td>${escapeHtml(sample.barcode || sample.id)}</td>
      <td><span class="badge ${sample.status === '已入库' ? 'badge--ok' : 'badge--pending'}">${sample.status}</span></td>
      <td>${escapeHtml(sample.sampleType || '-')}</td>
      <td>${escapeHtml(sample.sampleSource || '-')}</td>
      <td>${escapeHtml(sample.boxName || '-')}</td>
      <td>${escapeHtml(sample.boxPosition || '-')}</td>
      <td>${escapeHtml(formatLocation(sample.location) || '-')}</td>
      <td>${escapeHtml(sample.storedAt || '-')}</td>
    </tr>
  `).join('');
}

function renderLog() {
  if (!state.scanLog.length) {
    elements.logList.innerHTML = '<li class="empty">暂无扫码日志。</li>';
    return;
  }
  elements.logList.innerHTML = state.scanLog.map((item) => `
    <li class="log-item log-item--${item.level}">
      <span>${escapeHtml(item.time)}</span>
      <strong>${escapeHtml(item.sampleId || '-')}</strong>
      <em>${escapeHtml(item.message)}</em>
    </li>
  `).join('');
}

function render() {
  elements.scanInput.disabled = state.samples.size === 0;
  if (elements.boxPosition && !normaliseId(elements.boxPosition.value)) {
    elements.boxPosition.value = state.currentBoxPosition || 'A1';
  }
  updateStats();
  renderTable();
  renderLog();
  persistState();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[char]));
}

function detectSampleColumn(headers) {
  const normalisedHeaders = headers.map(normaliseHeader);
  const index = normalisedHeaders.findIndex((header) => SAMPLE_ID_HEADER_ALIASES.has(header));
  return index >= 0 ? index : 0;
}

function rowToRecord(headers, row) {
  return headers.reduce((record, header, index) => {
    const safeHeader = normaliseId(header) || `字段${index + 1}`;
    record[safeHeader] = normaliseId(row[index]);
    return record;
  }, {});
}

function extractBarcode(headers, row, fallback) {
  const barcodeIndex = headers.findIndex((header) => ['barcode', 'samplebarcode', '样本条码', '条码'].includes(normaliseHeader(header)));
  return barcodeIndex >= 0 ? normaliseId(row[barcodeIndex]) || fallback : fallback;
}

function rowsToSampleRecords(rows) {
  const cleanedRows = rows.map((row) => row.map(normaliseId)).filter((row) => row.some(Boolean));
  if (!cleanedRows.length) return { records: [], headers: [] };
  const firstRow = cleanedRows[0];
  const hasHeader = firstRow.some((cell) => SAMPLE_ID_HEADER_ALIASES.has(normaliseHeader(cell)));
  const columnIndex = hasHeader ? detectSampleColumn(firstRow) : 0;
  const headers = hasHeader ? firstRow : firstRow.map((_, index) => (index === columnIndex ? '样本编号' : `字段${index + 1}`));
  const dataRows = hasHeader ? cleanedRows.slice(1) : cleanedRows;
  const seen = new Set();
  const records = [];

  dataRows.forEach((row) => {
    const id = normaliseId(row[columnIndex]);
    if (!id || seen.has(id)) return;
    seen.add(id);
    records.push({ id, barcode: extractBarcode(headers, row, id), originalData: rowToRecord(headers, row) });
  });

  return { records, headers };
}

function rowsToSampleIds(rows) {
  return rowsToSampleRecords(rows).records.map((record) => record.id);
}

function parseDelimitedText(text) {
  return text.split(/\r?\n/).map((line) => {
    if (line.includes('\t')) return line.split('\t');
    return line.split(',');
  });
}

async function parseSampleFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (['xlsx', 'xls'].includes(ext)) {
    if (!window.XLSX) {
      throw new Error('Excel 解析库未加载，请检查网络后刷新页面，或上传 CSV/TXT 文件。');
    }
    const data = await file.arrayBuffer();
    const workbook = window.XLSX.read(data, { type: 'array' });
    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
    return rowsToSampleRecords(window.XLSX.utils.sheet_to_json(firstSheet, { header: 1, blankrows: false }));
  }
  const text = await file.text();
  return rowsToSampleRecords(parseDelimitedText(text));
}

async function handleFile(file) {
  if (!file) return;
  elements.fileHint.textContent = `正在读取：${file.name}`;
  try {
    const { records, headers } = await parseSampleFile(file);
    if (!records.length) throw new Error('没有读取到样本编号，请确认清单中包含“样本编号 / sample_id / barcode / sample barcode / id”等字段或第一列有数据。');
    state.samples = new Map(records.map((record) => [record.id, {
      id: record.id,
      barcode: record.barcode,
      originalData: record.originalData,
      status: '未入库',
      sampleType: '',
      sampleSource: '原始采集样本',
      returnCompany: '',
      boxName: '',
      boxPosition: '',
      location: null,
      storedAt: '',
    }]));
    state.scanLog = [];
    state.boxCounter = 1;
    state.currentBoxPosition = 'A1';
    state.originalHeaders = headers;
    elements.boxName.value = 'BOX-001';
    elements.boxPosition.value = 'A1';
    elements.fileHint.textContent = `已读取 ${records.length} 个候选入库样本：${file.name}（保留原始字段 ${headers.length} 个）`;
    showScanMessage('success', `清单上传成功：识别到 ${records.length} 个样本，可开始扫码。`);
    elements.scanInput.focus();
    addLog('success', `清单导入成功，共 ${records.length} 个样本`);
    render();
  } catch (error) {
    elements.fileHint.textContent = '读取失败，请重新选择文件。';
    showScanMessage('error', error.message);
    beep('error');
  } finally {
    if (elements.fileInput) elements.fileInput.value = '';
  }
}

function showScanMessage(level, message) {
  elements.scanMessage.textContent = message;
  elements.scanMessage.className = `message message--${level}`;
}

function inferNextBoxPosition() {
  const boxName = getCurrentBoxName();
  const positions = Array.from(state.samples.values())
    .filter((sample) => sample.status === '已入库' && sample.boxName === boxName && sample.boxPosition)
    .map((sample) => sample.boxPosition);
  if (!positions.length) return 'A1';
  return incrementBoxPosition(positions[positions.length - 1]);
}

function incrementBoxPosition(position) {
  const match = normaliseId(position).toUpperCase().match(/^([A-Z]+)(\d+)$/);
  if (!match) return 'A1';
  const [, row, numericColumn] = match;
  const column = Number(numericColumn);
  if (!Number.isFinite(column) || column < 1) return 'A1';
  if (column < DEFAULT_BOX_CAPACITY) return `${row}${column + 1}`;
  return `${nextRowName(row)}1`;
}

function nextRowName(row) {
  const chars = row.toUpperCase().split('');
  let index = chars.length - 1;
  while (index >= 0) {
    if (chars[index] !== 'Z') {
      chars[index] = String.fromCharCode(chars[index].charCodeAt(0) + 1);
      return chars.join('');
    }
    chars[index] = 'A';
    index -= 1;
  }
  return `A${chars.join('')}`;
}

function findSampleByScan(scanValue) {
  const sampleId = normaliseId(scanValue);
  return state.samples.get(sampleId) || Array.from(state.samples.values()).find((sample) => normaliseId(sample.barcode) === sampleId);
}

function handleScan(event) {
  event.preventDefault();
  const sampleId = normaliseId(elements.scanInput.value);
  if (!sampleId) return;
  const sample = findSampleByScan(sampleId);
  if (!sample) {
    showScanMessage('error', `未匹配样本：${sampleId} 不在上传清单中，请立即核对条码！`);
    addLog('error', '未在样本清单中匹配成功', sampleId);
    beep('error');
  } else if (sample.status === '已入库') {
    showScanMessage('warning', `重复扫码：${sampleId} 已在 ${sample.storedAt || '此前'} 入库，位置 ${sample.boxPosition || '-'}。`);
    addLog('warning', '重复扫码，样本此前已入库', sampleId);
    beep('error');
  } else {
    const boxPosition = normaliseId(elements.boxPosition.value).toUpperCase() || state.currentBoxPosition || 'A1';
    sample.status = '已入库';
    sample.sampleType = elements.sampleType.value;
    sample.sampleSource = elements.sampleSource.value;
    sample.returnCompany = sample.sampleSource === '测序返回样本' ? normaliseId(elements.returnCompany.value) : '';
    sample.boxName = getCurrentBoxName();
    sample.boxPosition = boxPosition;
    sample.location = buildLocation();
    sample.storedAt = new Date().toLocaleString('zh-CN', { hour12: false });
    state.currentBoxPosition = incrementBoxPosition(boxPosition);
    elements.boxPosition.value = state.currentBoxPosition;
    showScanMessage('success', `扫码成功：${sampleId} 已入库至 ${sample.boxName} / ${boxPosition}，下一位置 ${state.currentBoxPosition}。`);
    addLog('success', `扫码成功，位置 ${sample.boxName} / ${boxPosition}`, sampleId);
    beep('success');
  }
  elements.scanInput.value = '';
  elements.scanInput.focus();
  render();
}

function finishCurrentBox(event) {
  event.preventDefault();
  const boxName = getCurrentBoxName();
  const location = buildLocation();
  let count = 0;
  state.samples.forEach((sample) => {
    if (sample.boxName === boxName && sample.status === '已入库') {
      sample.location = location;
      count += 1;
    }
  });
  addLog('success', `盒子 ${boxName} 已放置到 ${formatLocation(location)}，本盒 ${count} 个样本`);
  state.boxCounter += 1;
  state.currentBoxPosition = 'A1';
  elements.boxName.value = `BOX-${String(state.boxCounter).padStart(3, '0')}`;
  elements.boxPosition.value = 'A1';
  showScanMessage('success', `已完成 ${boxName}（本盒 ${count} 个样本），请开始扫描下一盒。`);
  elements.scanInput.focus();
  render();
}

function exportCsv() {
  const extraHeaders = state.originalHeaders.filter((header) => header && !EXPORT_BASE_HEADERS.includes(header));
  const header = [...EXPORT_BASE_HEADERS, ...extraHeaders];
  const rows = Array.from(state.samples.values()).map((sample) => [
    sample.id,
    sample.barcode || sample.id,
    sample.status,
    sample.sampleType || '',
    sample.sampleSource || '',
    sample.returnCompany || '',
    sample.location?.freezer || '',
    sample.location?.shelf || '',
    sample.location?.column || '',
    sample.location?.drawer || '',
    sample.location?.cell || '',
    sample.boxName || '',
    sample.boxPosition || '',
    sample.storedAt || '',
    ...extraHeaders.map((headerName) => sample.originalData?.[headerName] || ''),
  ]);
  downloadCsv('sample-inventory-result.csv', [header, ...rows]);
}

function downloadTemplate() {
  downloadCsv('sample-list-template.csv', [['样本编号', '姓名', 'sample barcode', '备注'], ['SAMPLE-001', '张三', 'SAMPLE-001', ''], ['SAMPLE-002', '李四', 'SAMPLE-002', '']]);
}

function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function resetTask() {
  if (!confirm('确认重置当前入库任务？所有本地样本、扫码日志和位置记录将被清空。')) return;
  localStorage.removeItem(STORAGE_KEY);
  state.samples = new Map();
  state.scanLog = [];
  state.boxCounter = 1;
  state.currentBoxPosition = 'A1';
  state.originalHeaders = [];
  elements.boxName.value = 'BOX-001';
  elements.boxPosition.value = 'A1';
  elements.fileHint.textContent = '尚未选择文件';
  elements.fileInput.value = '';
  showScanMessage('info', '请先上传样本清单。');
  render();
}

function clearScanLog() {
  if (!state.scanLog.length) return;
  if (!confirm('确认清空扫码日志？样本入库状态不会被删除，但日志记录将不可恢复。')) return;
  state.scanLog = [];
  render();
}

function populateSelect(select, total, suffix) {
  select.innerHTML = Array.from({ length: total }, (_, index) => `<option value="${index + 1}">${index + 1}${suffix}</option>`).join('');
}


function syncSampleSourceControls() {
  const isSequencingReturned = elements.sampleSource.value === '测序返回样本';
  elements.returnCompany.disabled = !isSequencingReturned;
  if (!isSequencingReturned) elements.returnCompany.value = '';
}

function bindElements() {
  ['totalCount', 'storedCount', 'pendingCount', 'mismatchCount', 'currentBoxCount', 'positionPreview', 'fileInput', 'fileHint', 'dropzone', 'scanForm', 'boxName', 'boxPosition', 'sampleType', 'sampleSource', 'returnCompany', 'scanInput', 'scanMessage', 'locationForm', 'freezer', 'shelf', 'column', 'drawer', 'cell', 'sampleTable', 'searchInput', 'exportBtn', 'downloadTemplateBtn', 'resetBtn', 'logList', 'clearLogBtn'].forEach((id) => {
    elements[id] = document.getElementById(id);
  });
}

function init() {
  bindElements();
  populateSelect(elements.shelf, 4, '层');
  populateSelect(elements.column, 5, '列');
  populateSelect(elements.drawer, 5, '号抽箱');
  populateSelect(elements.cell, 5, '号格子');
  restoreState();
  if (!elements.boxName.value) elements.boxName.value = `BOX-${String(state.boxCounter).padStart(3, '0')}`;
  elements.boxPosition.value = state.currentBoxPosition || 'A1';

  elements.fileInput.addEventListener('change', (event) => handleFile(event.target.files[0]));
  elements.dropzone.addEventListener('dragover', (event) => {
    event.preventDefault();
    elements.dropzone.classList.add('is-dragover');
  });
  elements.dropzone.addEventListener('dragleave', () => elements.dropzone.classList.remove('is-dragover'));
  elements.dropzone.addEventListener('drop', (event) => {
    event.preventDefault();
    elements.dropzone.classList.remove('is-dragover');
    handleFile(event.dataTransfer.files[0]);
  });
  elements.scanForm.addEventListener('submit', handleScan);
  elements.locationForm.addEventListener('submit', finishCurrentBox);
  elements.searchInput.addEventListener('input', renderTable);
  elements.boxName.addEventListener('input', updateBoxSummary);
  elements.boxPosition.addEventListener('input', () => {
    state.currentBoxPosition = normaliseId(elements.boxPosition.value).toUpperCase() || 'A1';
    elements.boxPosition.value = state.currentBoxPosition;
    updateBoxSummary();
    persistState();
  });
  elements.sampleSource.addEventListener('change', syncSampleSourceControls);
  elements.exportBtn.addEventListener('click', exportCsv);
  elements.downloadTemplateBtn.addEventListener('click', downloadTemplate);
  elements.resetBtn.addEventListener('click', resetTask);
  elements.clearLogBtn.addEventListener('click', clearScanLog);
  syncSampleSourceControls();
  render();
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', init);
}

if (typeof module !== 'undefined') {
  module.exports = { normaliseId, normaliseHeader, rowsToSampleIds, rowsToSampleRecords, parseDelimitedText, formatLocation, incrementBoxPosition, SAMPLE_ID_HEADERS };
}
