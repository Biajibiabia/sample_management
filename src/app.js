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
const EXPORT_BASE_HEADERS = ['样本编号', '条码', '入库状态', '样本类型', '样本来源', '返回公司', '冰箱编号(001/002)', '层架序号(从上到下1-4)', '列序号(从左到右1-5)', '抽箱序号(每列从上到下1-5)', '格子序号(每抽箱从外到内1-5)', '盒号', '样本盒规格', '盒内位置', '完整位置', '扫码时间'];
const BOX_SPECS = {
  '10': { size: 10, label: '10×10', lastRow: 'J' },
  '9': { size: 9, label: '9×9', lastRow: 'I' },
};
const DEFAULT_BOX_SIZE = 10;

const state = {
  samples: new Map(),
  scanLog: [],
  scanHistory: [],
  currentBoxPosition: 'A1',
  currentBoxSize: DEFAULT_BOX_SIZE,
  currentFreezerLocation: { freezer: '001', shelf: '1', column: '1', drawer: '1', cell: '1' },
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

function getDefaultFreezerLocation() {
  return { freezer: '001', shelf: '1', column: '1', drawer: '1', cell: '1' };
}

function normaliseFreezerLocation(location = {}) {
  const defaults = getDefaultFreezerLocation();
  const freezer = ['001', '002'].includes(normaliseId(location.freezer)) ? normaliseId(location.freezer) : defaults.freezer;
  const clamp = (value, min, max, fallback) => {
    const number = Number(value);
    if (!Number.isInteger(number) || number < min || number > max) return fallback;
    return String(number);
  };
  return {
    freezer,
    shelf: clamp(location.shelf, 1, 4, defaults.shelf),
    column: clamp(location.column, 1, 5, defaults.column),
    drawer: clamp(location.drawer, 1, 5, defaults.drawer),
    cell: clamp(location.cell, 1, 5, defaults.cell),
  };
}

function buildLocation() {
  return normaliseFreezerLocation({
    freezer: elements.freezer.value,
    shelf: elements.shelf.value,
    column: elements.column.value,
    drawer: elements.drawer.value,
    cell: elements.cell.value,
  });
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
    scanHistory: state.scanHistory,
    currentBoxPosition: state.currentBoxPosition,
    currentBoxSize: state.currentBoxSize,
    currentFreezerLocation: state.currentFreezerLocation,
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
    state.scanHistory = parsed.scanHistory || inferScanHistoryFromLog();
    state.currentBoxSize = normaliseBoxSize(parsed.currentBoxSize);
    state.currentBoxPosition = parsed.currentBoxPosition || inferNextBoxPosition() || 'A1';
    state.currentFreezerLocation = normaliseFreezerLocation(parsed.currentFreezerLocation);
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
    boxSize: normaliseBoxSize(sample.boxSize),
  };
}

function normaliseBoxSize(value) {
  const key = String(value || DEFAULT_BOX_SIZE);
  return BOX_SPECS[key] ? Number(key) : DEFAULT_BOX_SIZE;
}

function getBoxSpec(boxSize = state.currentBoxSize) {
  return BOX_SPECS[String(normaliseBoxSize(boxSize))] || BOX_SPECS[String(DEFAULT_BOX_SIZE)];
}

function formatBoxSpec(boxSize) {
  return getBoxSpec(boxSize).label;
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

function inferScanHistoryFromLog() {
  return state.scanLog
    .filter((item) => item.level === 'success' && state.samples.get(item.sampleId)?.status === '已入库')
    .map((item) => item.sampleId)
    .reverse();
}

function getCurrentBoxName() {
  return normaliseId(elements.boxName?.value);
}

function getCurrentBoxStoredCount() {
  const boxName = getCurrentBoxName();
  if (!boxName) return 0;
  return Array.from(state.samples.values()).filter((sample) => sample.status === '已入库' && sample.boxName === boxName).length;
}

function updateBoxSummary() {
  if (!elements.currentBoxCount || !elements.positionPreview) return;
  elements.currentBoxCount.textContent = getCurrentBoxStoredCount();
  elements.positionPreview.textContent = `${normaliseId(elements.boxPosition.value) || state.currentBoxPosition || 'A1'} (${formatBoxSpec(state.currentBoxSize)})`;
}

function hasCurrentBoxStoredSamples() {
  return getCurrentBoxStoredCount() > 0;
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
  const samples = Array.from(state.samples.values()).filter((sample) => matchesSampleKeyword(sample, keyword));
  if (!samples.length) {
    elements.sampleTable.innerHTML = `<tr><td colspan="11" class="empty">${state.samples.size ? '没有符合搜索条件的样本。' : '请上传样本清单。'}</td></tr>`;
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
      <td>${escapeHtml(formatBoxSpec(sample.boxSize))}</td>
      <td>${escapeHtml(sample.boxPosition || '-')}</td>
      <td>${escapeHtml(formatSampleFullLocation(sample) || '-')}</td>
      <td>${escapeHtml(sample.storedAt || '-')}</td>
      <td>${sample.status === '已入库' ? `<button class="button button--mini button--ghost" type="button" data-withdraw-sample="${escapeHtml(sample.id)}">撤回</button>` : '-'}</td>
    </tr>
  `).join('');
}

function matchesSampleKeyword(sample, keyword) {
  if (!keyword) return true;
  return [
    sample.id,
    sample.barcode,
    sample.boxName,
    sample.boxPosition,
    formatBoxSpec(sample.boxSize),
    formatSampleFullLocation(sample),
  ].some((value) => String(value || '').toLowerCase().includes(keyword));
}

function formatSampleFullLocation(sample) {
  if (!sample || sample.status !== '已入库') return '';
  const parts = [];
  const freezerLocation = formatLocation(sample.location);
  if (freezerLocation) parts.push(freezerLocation);
  if (sample.boxName) parts.push(`盒子${sample.boxName}`);
  if (sample.boxSize) parts.push(`${formatBoxSpec(sample.boxSize)}规格`);
  if (sample.boxPosition) parts.push(`盒内${sample.boxPosition}`);
  return parts.join(' / ');
}

function renderLocationSearch() {
  if (!elements.locationSearchInput || !elements.locationSearchResult) return;
  const keyword = normaliseId(elements.locationSearchInput.value);
  if (!keyword) {
    elements.locationSearchResult.innerHTML = '<span class="empty-inline">输入样本编号或条码后点击查找，显示冰箱到盒内位置的完整路径。</span>';
    return;
  }
  const sample = findSampleByScan(keyword);
  if (!sample) {
    elements.locationSearchResult.innerHTML = `<span class="lookup-card lookup-card--warning">未找到样本：${escapeHtml(keyword)}。请确认已上传清单，或检查样本编号/条码。</span>`;
    return;
  }
  if (sample.status !== '已入库') {
    elements.locationSearchResult.innerHTML = `<span class="lookup-card lookup-card--pending"><strong>${escapeHtml(sample.id)}</strong> 尚未入库，当前没有冰箱和盒内位置记录。</span>`;
    return;
  }
  elements.locationSearchResult.innerHTML = `
    <div class="lookup-card">
      <strong>${escapeHtml(sample.id)}</strong>
      <span>条码：${escapeHtml(sample.barcode || sample.id)}</span>
      <span>${escapeHtml(formatSampleFullLocation(sample))}</span>
    </div>
  `;
}

function getRecentStoredSamples(limit = 6) {
  const boxName = getCurrentBoxName();
  if (!boxName) return [];
  const orderedIds = [...state.scanHistory].reverse();
  const seen = new Set();
  const recent = [];

  orderedIds.forEach((id) => {
    const sample = state.samples.get(id);
    if (!sample || sample.status !== '已入库' || sample.boxName !== boxName || seen.has(sample.id)) return;
    seen.add(sample.id);
    recent.push(sample);
  });

  if (recent.length < limit) {
    Array.from(state.samples.values())
      .filter((sample) => sample.status === '已入库' && sample.boxName === boxName && !seen.has(sample.id))
      .sort((a, b) => String(b.storedAt || '').localeCompare(String(a.storedAt || '')))
      .slice(0, limit - recent.length)
      .forEach((sample) => recent.push(sample));
  }

  return recent.slice(0, limit);
}

function renderRecentScans() {
  if (!elements.recentScansList) return;
  const recent = getRecentStoredSamples();
  if (!recent.length) {
    elements.recentScansList.innerHTML = '<span class="empty-inline">扫码后这里会显示最近记录，可撤回前面的扫码并重新录入。</span>';
    return;
  }
  elements.recentScansList.innerHTML = recent.map((sample, index) => `
    <button class="recent-scan-chip ${index === 0 ? 'recent-scan-chip--latest' : ''}" type="button" data-withdraw-sample="${escapeHtml(sample.id)}" title="撤回 ${escapeHtml(sample.id)} 并重新扫码">
      <strong>${index === 0 ? '上一支' : '撤回'}</strong>
      <span>${escapeHtml(sample.id)}</span>
      <small>${escapeHtml([sample.boxName, sample.boxPosition].filter(Boolean).join(' / ') || '已入库')}</small>
    </button>
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
  if (elements.undoLastScanBtn) elements.undoLastScanBtn.disabled = !hasCurrentBoxStoredSamples();
  if (elements.boxPosition && !normaliseId(elements.boxPosition.value)) {
    elements.boxPosition.value = state.currentBoxPosition || '';
  }
  if (elements.boxSize) elements.boxSize.value = String(state.currentBoxSize);
  updateStats();
  renderLocationSearch();
  renderTable();
  renderRecentScans();
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
    const selectedBoxSize = normaliseBoxSize(elements.boxSize?.value);
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
      boxSize: selectedBoxSize,
      storedAt: '',
    }]));
    state.scanLog = [];
    state.scanHistory = [];
    state.currentBoxPosition = 'A1';
    state.currentBoxSize = selectedBoxSize;
    state.currentFreezerLocation = buildLocation();
    state.originalHeaders = headers;
    elements.boxName.value = '';
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
  return incrementBoxPosition(positions[positions.length - 1], state.currentBoxSize) || '';
}

function normaliseBoxPosition(position, boxSize = DEFAULT_BOX_SIZE) {
  const match = normaliseId(position).toUpperCase().match(/^([A-Z])(\d{1,2})$/);
  if (!match) return '';
  const [, row, numericColumn] = match;
  const column = Number(numericColumn);
  const size = getBoxSpec(boxSize).size;
  const rowIndex = row.charCodeAt(0) - 65;
  if (rowIndex < 0 || rowIndex >= size || column < 1 || column > size) return '';
  return `${row}${column}`;
}

function incrementBoxPosition(position, boxSize = DEFAULT_BOX_SIZE) {
  const current = normaliseBoxPosition(position, boxSize);
  if (!current) return 'A1';
  const [, row, numericColumn] = current.match(/^([A-Z])(\d+)$/);
  const column = Number(numericColumn);
  const size = getBoxSpec(boxSize).size;
  const rowIndex = row.charCodeAt(0) - 65;
  if (column < size) return `${row}${column + 1}`;
  if (rowIndex < size - 1) return `${String.fromCharCode(row.charCodeAt(0) + 1)}1`;
  return '';
}

function findNextAvailableBoxPosition(position, boxName, boxSize = DEFAULT_BOX_SIZE) {
  let nextPosition = incrementBoxPosition(position, boxSize);
  while (nextPosition && isBoxPositionTaken(boxName, nextPosition)) {
    nextPosition = incrementBoxPosition(nextPosition, boxSize);
  }
  return nextPosition;
}

function isBoxPositionTaken(boxName, boxPosition, ignoredSampleId = '') {
  return Array.from(state.samples.values()).some((sample) => (
    sample.id !== ignoredSampleId
    && sample.status === '已入库'
    && sample.boxName === boxName
    && sample.boxPosition === boxPosition
  ));
}

function findSampleByScan(scanValue) {
  const sampleId = normaliseId(scanValue);
  return state.samples.get(sampleId) || Array.from(state.samples.values()).find((sample) => normaliseId(sample.barcode) === sampleId);
}

function handleScan(event) {
  event.preventDefault();
  const sampleId = normaliseId(elements.scanInput.value);
  if (!sampleId) return;
  if (!state.samples.size) {
    showScanMessage('info', '请先上传样本清单。');
    elements.scanInput.value = '';
    return;
  }
  const boxName = getCurrentBoxName();
  if (!boxName) {
    showScanMessage('warning', '请先录入当前盒号/名称。');
    elements.scanInput.value = '';
    elements.boxName.focus();
    return;
  }
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
    const boxSize = normaliseBoxSize(elements.boxSize.value);
    const requestedPosition = normaliseId(elements.boxPosition.value).toUpperCase() || state.currentBoxPosition;
    const boxPosition = normaliseBoxPosition(requestedPosition, boxSize);
    if (!boxPosition) {
      showScanMessage('error', `盒内位置无效：${requestedPosition || '空'}。${formatBoxSpec(boxSize)}盒只允许 A-${getBoxSpec(boxSize).lastRow} 行、1-${getBoxSpec(boxSize).size} 列，例如 A1、B2。`);
      addLog('error', `盒内位置无效：${requestedPosition || '空'}`, sampleId);
      beep('error');
    } else if (isBoxPositionTaken(boxName, boxPosition, sample.id)) {
      showScanMessage('error', `位置冲突：${boxName} / ${boxPosition} 已有样本，请核对盒内位置后再扫码。`);
      addLog('error', `盒内位置冲突：${boxName} / ${boxPosition}`, sampleId);
      beep('error');
    } else {
      state.currentBoxSize = boxSize;
      sample.status = '已入库';
      sample.sampleType = elements.sampleType.value;
      sample.sampleSource = elements.sampleSource.value;
      sample.returnCompany = sample.sampleSource === '测序返回样本' ? normaliseId(elements.returnCompany.value) : '';
      sample.boxName = boxName;
      sample.boxSize = boxSize;
      sample.boxPosition = boxPosition;
      sample.location = buildLocation();
      sample.storedAt = new Date().toLocaleString('zh-CN', { hour12: false });
      state.scanHistory.push(sample.id);
      state.currentBoxPosition = findNextAvailableBoxPosition(boxPosition, boxName, boxSize);
      elements.boxPosition.value = state.currentBoxPosition;
      const nextHint = state.currentBoxPosition ? `下一位置 ${state.currentBoxPosition}` : '当前样本盒已满，请完成当前盒并开始下一盒';
      showScanMessage('success', `扫码成功：${sampleId} 已入库至 ${sample.boxName} / ${formatBoxSpec(boxSize)} / ${boxPosition}，${nextHint}。`);
      addLog('success', `扫码成功，位置 ${formatSampleFullLocation(sample)}`, sampleId);
      beep('success');
    }
  }
  elements.scanInput.value = '';
  elements.scanInput.focus();
  render();
}

function getNextFreezerLocation(location) {
  const freezerOrder = ['001', '002'];
  const current = normaliseFreezerLocation(location);
  const next = {
    freezer: current.freezer,
    shelf: Number(current.shelf),
    column: Number(current.column),
    drawer: Number(current.drawer),
    cell: Number(current.cell),
  };

  if (next.cell < 5) {
    next.cell += 1;
  } else if (next.drawer < 5) {
    next.cell = 1;
    next.drawer += 1;
  } else if (next.column < 5) {
    next.cell = 1;
    next.drawer = 1;
    next.column += 1;
  } else if (next.shelf < 4) {
    next.cell = 1;
    next.drawer = 1;
    next.column = 1;
    next.shelf += 1;
  } else {
    const freezerIndex = freezerOrder.indexOf(next.freezer);
    if (freezerIndex >= 0 && freezerIndex < freezerOrder.length - 1) {
      next.freezer = freezerOrder[freezerIndex + 1];
      next.shelf = 1;
      next.column = 1;
      next.drawer = 1;
      next.cell = 1;
    } else {
      return null;
    }
  }

  return {
    freezer: next.freezer,
    shelf: String(next.shelf),
    column: String(next.column),
    drawer: String(next.drawer),
    cell: String(next.cell),
  };
}

function applyLocationToControls(location) {
  if (!location) return;
  const safeLocation = normaliseFreezerLocation(location);
  elements.freezer.value = safeLocation.freezer;
  elements.shelf.value = safeLocation.shelf;
  elements.column.value = safeLocation.column;
  elements.drawer.value = safeLocation.drawer;
  elements.cell.value = safeLocation.cell;
  state.currentFreezerLocation = safeLocation;
}

function syncCurrentFreezerLocationFromControls() {
  state.currentFreezerLocation = buildLocation();
  persistState();
}

function finishCurrentBox(event) {
  event.preventDefault();
  const boxName = getCurrentBoxName();
  if (!boxName) {
    showScanMessage('warning', '请先录入当前盒号/名称。');
    elements.boxName.focus();
    return;
  }

  const samplesInCurrentBox = Array.from(state.samples.values())
    .filter((sample) => sample.boxName === boxName && sample.status === '已入库');
  const count = samplesInCurrentBox.length;
  if (count === 0) {
    showScanMessage('warning', '当前盒没有扫码入库样本，不会保存当前盒，也不会切换盒号或冰箱位置。');
    elements.scanInput.focus();
    return;
  }

  const location = buildLocation();
  samplesInCurrentBox.forEach((sample) => {
    sample.location = location;
  });
  state.currentFreezerLocation = location;
  const nextLocation = getNextFreezerLocation(location);
  addLog('success', `盒子 ${boxName} 已放置到 ${formatLocation(location)}，本盒 ${count} 个样本`);
  state.currentBoxPosition = 'A1';
  state.currentBoxSize = normaliseBoxSize(elements.boxSize.value);
  elements.boxName.value = '';
  elements.boxPosition.value = 'A1';
  if (nextLocation) {
    applyLocationToControls(nextLocation);
  } else {
    state.currentFreezerLocation = location;
  }
  const locationHint = nextLocation ? `冰箱位置已自动跳到下一格：${formatLocation(nextLocation)}。` : '当前冰箱位置已到末格，请手动选择下一处存放位置。';
  showScanMessage('success', `已完成 ${boxName}（本盒 ${count} 个样本）。已完成当前盒，请手动录入下一盒盒号后继续扫码。${locationHint}`);
  elements.scanInput.focus();
  render();
}

function resetSampleInventory(sample) {
  sample.status = '未入库';
  sample.sampleType = '';
  sample.sampleSource = '原始采集样本';
  sample.returnCompany = '';
  sample.boxName = '';
  sample.boxPosition = '';
  sample.location = null;
  sample.boxSize = normaliseBoxSize(elements.boxSize?.value || state.currentBoxSize);
  sample.storedAt = '';
}

function withdrawSample(sampleId, source = 'manual') {
  const sample = state.samples.get(sampleId);
  if (!sample || sample.status !== '已入库') {
    showScanMessage('warning', `无法撤回：${sampleId || '样本'} 当前没有入库记录。`);
    return false;
  }
  const previous = {
    boxName: sample.boxName,
    boxPosition: sample.boxPosition,
    boxSize: sample.boxSize,
    location: sample.location,
  };
  resetSampleInventory(sample);
  state.scanHistory = state.scanHistory.filter((id) => id !== sample.id);

  if (previous.boxName && previous.boxName === getCurrentBoxName()) {
    state.currentBoxSize = normaliseBoxSize(previous.boxSize);
    state.currentBoxPosition = previous.boxPosition || state.currentBoxPosition || 'A1';
    elements.boxSize.value = String(state.currentBoxSize);
    elements.boxPosition.value = state.currentBoxPosition;
    if (previous.location) applyLocationToControls(previous.location);
  }

  const locationText = [previous.boxName, formatBoxSpec(previous.boxSize), previous.boxPosition].filter(Boolean).join(' / ');
  addLog('warning', `已撤回入库记录${locationText ? `（原位置 ${locationText}）` : ''}，可重新扫码录入`, sample.id);
  showScanMessage('warning', `已撤回 ${sample.id} 的扫码入库记录，可重新扫码录入。${previous.boxName === getCurrentBoxName() ? `盒内位置已回到 ${previous.boxPosition || state.currentBoxPosition}。` : '当前盒号不变，重新扫码时将使用当前输入的位置。'}`);
  elements.scanInput.focus();
  render();
  return source === 'manual';
}

function undoLastScan() {
  const boxName = getCurrentBoxName();
  if (!boxName) {
    showScanMessage('warning', '请先录入当前盒号/名称。');
    elements.boxName.focus();
    return;
  }
  const sampleId = [...state.scanHistory].reverse()
    .find((id) => {
      const sample = state.samples.get(id);
      return sample?.status === '已入库' && sample.boxName === boxName;
    });
  if (!sampleId) {
    showScanMessage('warning', '当前盒没有可撤回的扫码入库记录。');
    return;
  }
  withdrawSample(sampleId, 'last');
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
    formatBoxSpec(sample.boxSize),
    sample.boxPosition || '',
    formatSampleFullLocation(sample),
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
  state.scanHistory = [];
  state.currentBoxPosition = 'A1';
  state.currentBoxSize = DEFAULT_BOX_SIZE;
  state.currentFreezerLocation = getDefaultFreezerLocation();
  state.originalHeaders = [];
  elements.boxName.value = '';
  elements.boxPosition.value = 'A1';
  if (elements.boxSize) elements.boxSize.value = String(DEFAULT_BOX_SIZE);
  applyLocationToControls(state.currentFreezerLocation);
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
  ['undoLastScanBtn', 'recentScansPanel', 'recentScansList', 'totalCount', 'storedCount', 'pendingCount', 'mismatchCount', 'currentBoxCount', 'positionPreview', 'fileInput', 'fileHint', 'dropzone', 'scanForm', 'boxName', 'boxSize', 'boxPosition', 'sampleType', 'sampleSource', 'returnCompany', 'scanInput', 'scanMessage', 'locationForm', 'freezer', 'shelf', 'column', 'drawer', 'cell', 'sampleTable', 'searchInput', 'locationSearchForm', 'locationSearchInput', 'locationSearchResult', 'exportBtn', 'downloadTemplateBtn', 'resetBtn', 'logList', 'clearLogBtn'].forEach((id) => {
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
  elements.boxSize.value = String(state.currentBoxSize);
  elements.boxPosition.value = state.currentBoxPosition || 'A1';
  applyLocationToControls(state.currentFreezerLocation);

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
  elements.undoLastScanBtn.addEventListener('click', undoLastScan);
  elements.recentScansList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-withdraw-sample]');
    if (!button) return;
    withdrawSample(button.dataset.withdrawSample);
  });
  elements.locationForm.addEventListener('submit', finishCurrentBox);
  elements.searchInput.addEventListener('input', renderTable);
  elements.sampleTable.addEventListener('click', (event) => {
    const button = event.target.closest('[data-withdraw-sample]');
    if (!button) return;
    withdrawSample(button.dataset.withdrawSample);
  });
  elements.locationSearchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    renderLocationSearch();
  });
  elements.locationSearchInput.addEventListener('input', renderLocationSearch);
  elements.boxName.addEventListener('input', updateBoxSummary);
  elements.boxSize.addEventListener('change', () => {
    state.currentBoxSize = normaliseBoxSize(elements.boxSize.value);
    const currentPosition = normaliseBoxPosition(elements.boxPosition.value || state.currentBoxPosition, state.currentBoxSize);
    state.currentBoxPosition = currentPosition || 'A1';
    elements.boxPosition.value = state.currentBoxPosition;
    updateBoxSummary();
    persistState();
  });
  elements.boxPosition.addEventListener('input', () => {
    state.currentBoxPosition = normaliseId(elements.boxPosition.value).toUpperCase();
    elements.boxPosition.value = state.currentBoxPosition;
    updateBoxSummary();
    persistState();
  });
  [elements.freezer, elements.shelf, elements.column, elements.drawer, elements.cell].forEach((select) => {
    select.addEventListener('change', syncCurrentFreezerLocationFromControls);
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
  module.exports = { state, elements, normaliseId, normaliseHeader, rowsToSampleIds, rowsToSampleRecords, parseDelimitedText, formatLocation, formatSampleFullLocation, formatBoxSpec, normaliseBoxPosition, incrementBoxPosition, findNextAvailableBoxPosition, getNextFreezerLocation, normaliseFreezerLocation, handleFile, handleScan, finishCurrentBox, undoLastScan, resetTask, SAMPLE_ID_HEADERS };
}
