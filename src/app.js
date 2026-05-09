const STORAGE_KEY = 'biobank-scan-inventory-state-v1';
const SAMPLE_ID_HEADERS = ['样本编号', '样本id', '编号', 'sample_id', 'sampleid', 'barcode', 'sample barcode', 'id'];

const state = {
  samples: new Map(),
  scanLog: [],
  boxCounter: 1,
};

const elements = {};

function normaliseId(value) {
  return String(value ?? '').trim();
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
  return `冰箱${location.freezer} / ${location.shelf}层 / ${location.column}列 / ${location.drawer}抽箱 / ${location.cell}格`;
}

function beep(type = 'error') {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return;
  const context = new AudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = type === 'success' ? 'sine' : 'square';
  oscillator.frequency.value = type === 'success' ? 880 : 220;
  gain.gain.setValueAtTime(0.09, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.18);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.18);
}

function serialiseState() {
  return {
    samples: Array.from(state.samples.values()),
    scanLog: state.scanLog,
    boxCounter: state.boxCounter,
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
    state.samples = new Map((parsed.samples || []).map((sample) => [sample.id, sample]));
    state.scanLog = parsed.scanLog || [];
    state.boxCounter = parsed.boxCounter || 1;
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
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

function updateStats() {
  const samples = Array.from(state.samples.values());
  const stored = samples.filter((sample) => sample.status === '已入库').length;
  elements.totalCount.textContent = samples.length;
  elements.storedCount.textContent = stored;
  elements.pendingCount.textContent = samples.length - stored;
  elements.mismatchCount.textContent = state.scanLog.filter((item) => item.level === 'error').length;
}

function renderTable() {
  const keyword = normaliseId(elements.searchInput.value).toLowerCase();
  const samples = Array.from(state.samples.values()).filter((sample) => sample.id.toLowerCase().includes(keyword));
  if (!samples.length) {
    elements.sampleTable.innerHTML = `<tr><td colspan="5" class="empty">${state.samples.size ? '没有符合搜索条件的样本。' : '请上传样本清单。'}</td></tr>`;
    return;
  }
  elements.sampleTable.innerHTML = samples.map((sample) => `
    <tr class="${sample.status === '已入库' ? 'is-stored' : ''}">
      <td><strong>${escapeHtml(sample.id)}</strong></td>
      <td><span class="badge ${sample.status === '已入库' ? 'badge--ok' : 'badge--pending'}">${sample.status}</span></td>
      <td>${escapeHtml(sample.boxName || '-')}</td>
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
  const normalisedHeaders = headers.map((header) => normaliseId(header).toLowerCase());
  const index = normalisedHeaders.findIndex((header) => SAMPLE_ID_HEADERS.includes(header));
  return index >= 0 ? index : 0;
}

function rowsToSampleIds(rows) {
  const cleanedRows = rows.map((row) => row.map(normaliseId)).filter((row) => row.some(Boolean));
  if (!cleanedRows.length) return [];
  const firstRow = cleanedRows[0];
  const hasHeader = firstRow.some((cell) => SAMPLE_ID_HEADERS.includes(cell.toLowerCase()));
  const columnIndex = hasHeader ? detectSampleColumn(firstRow) : 0;
  const dataRows = hasHeader ? cleanedRows.slice(1) : cleanedRows;
  return [...new Set(dataRows.map((row) => normaliseId(row[columnIndex])).filter(Boolean))];
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
    return rowsToSampleIds(window.XLSX.utils.sheet_to_json(firstSheet, { header: 1, blankrows: false }));
  }
  const text = await file.text();
  return rowsToSampleIds(parseDelimitedText(text));
}

async function handleFile(file) {
  if (!file) return;
  elements.fileHint.textContent = `正在读取：${file.name}`;
  try {
    const ids = await parseSampleFile(file);
    if (!ids.length) throw new Error('没有读取到样本编号，请确认清单第一列或“样本编号”列有数据。');
    state.samples = new Map(ids.map((id) => [id, {
      id,
      status: '未入库',
      boxName: '',
      location: null,
      storedAt: '',
    }]));
    state.scanLog = [];
    state.boxCounter = 1;
    elements.boxName.value = 'BOX-001';
    elements.fileHint.textContent = `已读取 ${ids.length} 个候选入库样本：${file.name}`;
    elements.scanMessage.textContent = '清单上传成功，可以开始扫码。';
    elements.scanMessage.className = 'message message--success';
    elements.scanInput.focus();
    addLog('success', `清单导入成功，共 ${ids.length} 个样本`);
    render();
  } catch (error) {
    elements.fileHint.textContent = '读取失败，请重新选择文件。';
    elements.scanMessage.textContent = error.message;
    elements.scanMessage.className = 'message message--error';
    beep('error');
  }
}

function handleScan(event) {
  event.preventDefault();
  const sampleId = normaliseId(elements.scanInput.value);
  if (!sampleId) return;
  const sample = state.samples.get(sampleId);
  if (!sample) {
    elements.scanMessage.textContent = `报警：样本 ${sampleId} 未在清单中匹配成功！`;
    elements.scanMessage.className = 'message message--error';
    addLog('error', '未在样本清单中匹配成功', sampleId);
    beep('error');
  } else if (sample.status === '已入库') {
    elements.scanMessage.textContent = `提醒：样本 ${sampleId} 已经入库，请勿重复扫码。`;
    elements.scanMessage.className = 'message message--warning';
    addLog('warning', '重复扫码，样本此前已入库', sampleId);
    beep('error');
  } else {
    sample.status = '已入库';
    sample.boxName = getCurrentBoxName();
    sample.location = buildLocation();
    sample.storedAt = new Date().toLocaleString('zh-CN', { hour12: false });
    elements.scanMessage.textContent = `成功：样本 ${sampleId} 已标记入库。`;
    elements.scanMessage.className = 'message message--success';
    addLog('success', '扫码匹配成功并标记已入库', sampleId);
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
  elements.boxName.value = `BOX-${String(state.boxCounter).padStart(3, '0')}`;
  elements.scanMessage.textContent = `已完成 ${boxName}，请开始扫描下一盒。`;
  elements.scanMessage.className = 'message message--success';
  elements.scanInput.focus();
  render();
}

function exportCsv() {
  const header = ['样本编号', '状态', '盒子', '冰箱', '层', '列', '抽箱', '格子', '入库时间'];
  const rows = Array.from(state.samples.values()).map((sample) => [
    sample.id,
    sample.status,
    sample.boxName,
    sample.location?.freezer || '',
    sample.location?.shelf || '',
    sample.location?.column || '',
    sample.location?.drawer || '',
    sample.location?.cell || '',
    sample.storedAt,
  ]);
  downloadCsv('sample-inventory-result.csv', [header, ...rows]);
}

function downloadTemplate() {
  downloadCsv('sample-list-template.csv', [['样本编号'], ['SAMPLE-001'], ['SAMPLE-002']]);
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
  if (!confirm('确认重置当前入库任务？所有本地记录将被清空。')) return;
  localStorage.removeItem(STORAGE_KEY);
  state.samples = new Map();
  state.scanLog = [];
  state.boxCounter = 1;
  elements.boxName.value = 'BOX-001';
  elements.fileHint.textContent = '尚未选择文件';
  elements.scanMessage.textContent = '请先上传样本清单。';
  elements.scanMessage.className = 'message';
  render();
}

function populateSelect(select, total, suffix) {
  select.innerHTML = Array.from({ length: total }, (_, index) => `<option value="${index + 1}">${index + 1}${suffix}</option>`).join('');
}

function bindElements() {
  ['totalCount', 'storedCount', 'pendingCount', 'mismatchCount', 'fileInput', 'fileHint', 'dropzone', 'scanForm', 'boxName', 'scanInput', 'scanMessage', 'locationForm', 'freezer', 'shelf', 'column', 'drawer', 'cell', 'sampleTable', 'searchInput', 'exportBtn', 'downloadTemplateBtn', 'resetBtn', 'logList', 'clearLogBtn'].forEach((id) => {
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
  elements.exportBtn.addEventListener('click', exportCsv);
  elements.downloadTemplateBtn.addEventListener('click', downloadTemplate);
  elements.resetBtn.addEventListener('click', resetTask);
  elements.clearLogBtn.addEventListener('click', () => {
    state.scanLog = [];
    render();
  });
  render();
}

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', init);
}

if (typeof module !== 'undefined') {
  module.exports = { normaliseId, rowsToSampleIds, parseDelimitedText, formatLocation, SAMPLE_ID_HEADERS };
}
