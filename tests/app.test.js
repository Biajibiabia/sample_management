const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');
const localStore = new Map();
const sandbox = {
  module: { exports: {} },
  document: undefined,
  window: {},
  confirm: () => true,
  localStorage: {
    getItem: (key) => localStore.get(key) || null,
    setItem: (key, value) => localStore.set(key, value),
    removeItem: (key) => localStore.delete(key),
  },
};
vm.createContext(sandbox);
vm.runInContext(appSource, sandbox);

const {
  SAMPLE_ID_HEADERS,
  elements,
  state,
  finishCurrentBox,
  formatLocation,
  formatSampleFullLocation,
  formatBoxSpec,
  getNextFreezerLocation,
  handleFile,
  handleScan,
  incrementBoxPosition,
  normaliseBoxPosition,
  normaliseFreezerLocation,
  normaliseHeader,
  normaliseId,
  parseDelimitedText,
  resetTask,
  rowsToSampleIds,
  rowsToSampleRecords,
  undoLastScan,
} = sandbox.module.exports;

function makeElement(value = '') {
  return {
    value,
    textContent: '',
    innerHTML: '',
    className: '',
    disabled: false,
    focused: false,
    addEventListener() {},
    focus() { this.focused = true; },
  };
}

function installElements(overrides = {}) {
  Object.keys(elements).forEach((key) => delete elements[key]);
  Object.assign(elements, {
    totalCount: makeElement(),
    storedCount: makeElement(),
    pendingCount: makeElement(),
    mismatchCount: makeElement(),
    currentBoxCount: makeElement(),
    positionPreview: makeElement(),
    fileHint: makeElement('尚未选择文件'),
    fileInput: makeElement(),
    scanInput: makeElement(),
    undoLastScanBtn: makeElement(),
    boxName: makeElement(''),
    boxSize: makeElement('10'),
    boxPosition: makeElement('A1'),
    sampleType: makeElement('血浆'),
    sampleSource: makeElement('原始采集样本'),
    returnCompany: makeElement(''),
    scanMessage: makeElement(),
    freezer: makeElement('001'),
    shelf: makeElement('1'),
    column: makeElement('1'),
    drawer: makeElement('1'),
    cell: makeElement('1'),
    sampleTable: makeElement(),
    searchInput: makeElement(''),
    locationSearchInput: makeElement(''),
    locationSearchResult: makeElement(),
    recentScansList: makeElement(),
    logList: makeElement(),
    ...overrides,
  });
}

function resetStateWithSamples(ids = ['S1', 'S2', 'S3']) {
  localStore.clear();
  state.samples = new Map(ids.map((id) => [id, {
    id,
    barcode: id,
    originalData: { 样本编号: id },
    status: '未入库',
    sampleType: '',
    sampleSource: '原始采集样本',
    returnCompany: '',
    boxName: '',
    boxPosition: '',
    location: null,
    boxSize: 10,
    storedAt: '',
  }]));
  state.scanLog = [];
  state.scanHistory = [];
  state.currentBoxPosition = 'A1';
  state.currentBoxSize = 10;
  state.currentFreezerLocation = { freezer: '001', shelf: '1', column: '1', drawer: '1', cell: '1' };
  state.originalHeaders = ['样本编号'];
}

function submitScan(sampleId) {
  elements.scanInput.value = sampleId;
  handleScan({ preventDefault() {} });
}

function finishBox() {
  finishCurrentBox({ preventDefault() {} });
}

(async () => {
  assert.equal(normaliseId('  SAMPLE-001\n'), 'SAMPLE-001');
  assert.equal(normaliseHeader(' Sample Barcode '), 'samplebarcode');
  assert.ok(SAMPLE_ID_HEADERS.includes('sample barcode'));
  assert.equal(JSON.stringify(rowsToSampleIds([
    ['样本编号', '姓名'],
    ['S-001', 'A'],
    ['S-002', 'B'],
    ['S-001', 'duplicate'],
  ])), JSON.stringify(['S-001', 'S-002']));
  assert.equal(JSON.stringify(rowsToSampleIds([
    ['sample_id', 'box'],
    ['BIO-1', 'BOX-1'],
  ])), JSON.stringify(['BIO-1']));
  assert.equal(JSON.stringify(rowsToSampleIds([
    ['sample barcode', '项目', '备注'],
    ['BC-1', 'P1', 'keep'],
  ])), JSON.stringify(['BC-1']));
  assert.equal(JSON.stringify(rowsToSampleIds([
    ['ID', '姓名'],
    ['ID-001', '王五'],
  ])), JSON.stringify(['ID-001']));
  const parsedRecords = rowsToSampleRecords([
    ['barcode', '姓名', '备注'],
    ['B-001', '张三', '原始字段保留'],
  ]);
  assert.equal(JSON.stringify(parsedRecords.headers), JSON.stringify(['barcode', '姓名', '备注']));
  assert.equal(parsedRecords.records[0].originalData['备注'], '原始字段保留');
  assert.equal(parsedRecords.records[0].barcode, 'B-001');
  const recordsWithSeparateBarcode = rowsToSampleRecords([
    ['sample_id', 'barcode', '备注'],
    ['S-100', 'BC-100', '双字段'],
  ]);
  assert.equal(recordsWithSeparateBarcode.records[0].id, 'S-100');
  assert.equal(recordsWithSeparateBarcode.records[0].barcode, 'BC-100');
  assert.equal(JSON.stringify(parseDelimitedText('样本编号\nA001\nA002')), JSON.stringify([['样本编号'], ['A001'], ['A002']]));
  assert.equal(JSON.stringify(parseDelimitedText('样本编号,姓名\nA001,张三')), JSON.stringify([['样本编号', '姓名'], ['A001', '张三']]));
  assert.equal(formatLocation({ freezer: '001', shelf: '2', column: '3', drawer: '4', cell: '5' }), '冰箱001 / 从上到下第2层 / 从左到右第3列 / 从上到下第4抽箱 / 从外到内第5格');
  assert.equal(formatBoxSpec(10), '10×10');
  assert.equal(formatBoxSpec(9), '9×9');
  assert.equal(normaliseBoxPosition(' a2 ', 10), 'A2');
  assert.equal(normaliseBoxPosition('J10', 10), 'J10');
  assert.equal(normaliseBoxPosition('J10', 9), '');
  assert.equal(normaliseBoxPosition('I9', 9), 'I9');
  assert.equal(incrementBoxPosition('A1'), 'A2');
  assert.equal(incrementBoxPosition('A10', 10), 'B1');
  assert.equal(incrementBoxPosition('I9', 9), '');
  assert.equal(incrementBoxPosition('J10', 10), '');
  assert.equal(JSON.stringify(normaliseFreezerLocation({ freezer: '999', shelf: '9', column: '0', drawer: 'x', cell: '2' })), JSON.stringify({ freezer: '001', shelf: '1', column: '1', drawer: '1', cell: '2' }));
  assert.equal(JSON.stringify(getNextFreezerLocation({ freezer: '001', shelf: '1', column: '1', drawer: '1', cell: '1' })), JSON.stringify({ freezer: '001', shelf: '1', column: '1', drawer: '1', cell: '2' }));
  assert.equal(JSON.stringify(getNextFreezerLocation({ freezer: '001', shelf: '1', column: '1', drawer: '1', cell: '5' })), JSON.stringify({ freezer: '001', shelf: '1', column: '1', drawer: '2', cell: '1' }));
  assert.equal(JSON.stringify(getNextFreezerLocation({ freezer: '001', shelf: '1', column: '1', drawer: '5', cell: '5' })), JSON.stringify({ freezer: '001', shelf: '1', column: '2', drawer: '1', cell: '1' }));
  assert.equal(JSON.stringify(getNextFreezerLocation({ freezer: '001', shelf: '4', column: '5', drawer: '5', cell: '5' })), JSON.stringify({ freezer: '002', shelf: '1', column: '1', drawer: '1', cell: '1' }));
  assert.equal(getNextFreezerLocation({ freezer: '002', shelf: '4', column: '5', drawer: '5', cell: '5' }), null);
  assert.equal(formatSampleFullLocation({
    id: 'S-1',
    status: '已入库',
    location: { freezer: '001', shelf: '2', column: '3', drawer: '4', cell: '5' },
    boxName: 'MANUAL-001',
    boxSize: 9,
    boxPosition: 'B2',
  }), '冰箱001 / 从上到下第2层 / 从左到右第3列 / 从上到下第4抽箱 / 从外到内第5格 / 盒子MANUAL-001 / 9×9规格 / 盒内B2');

  installElements();
  resetStateWithSamples(['S1']);
  submitScan('S1');
  assert.equal(state.samples.get('S1').status, '未入库');
  assert.equal(elements.scanMessage.textContent, '请先录入当前盒号/名称。');

  installElements();
  resetStateWithSamples(['S1']);
  finishBox();
  assert.equal(elements.scanMessage.textContent, '请先录入当前盒号/名称。');
  assert.equal(elements.cell.value, '1');

  installElements({ boxName: makeElement('WILL-BE-CLEARED') });
  await handleFile({ name: 'samples.csv', text: async () => '样本编号\nS1\nS2' });
  assert.equal(elements.boxName.value, '');
  assert.equal(elements.boxPosition.value, 'A1');
  elements.boxName.value = 'WILL-BE-CLEARED';
  resetTask();
  assert.equal(elements.boxName.value, '');

  installElements({ boxName: makeElement('BOX-MANUAL-1') });
  resetStateWithSamples(['S1', 'S2']);
  submitScan('S1');
  assert.equal(state.samples.get('S1').status, '已入库');
  assert.equal(state.samples.get('S1').boxName, 'BOX-MANUAL-1');
  assert.equal(elements.boxPosition.value, 'A2');
  finishBox();
  assert.equal(elements.boxName.value, '');
  assert.equal(elements.boxPosition.value, 'A1');
  assert.equal(elements.cell.value, '2');
  assert.equal(state.samples.get('S1').location.cell, '1');

  installElements({ boxName: makeElement('BOX-SKIP') });
  resetStateWithSamples(['S1', 'S2']);
  state.samples.get('S2').status = '已入库';
  state.samples.get('S2').boxName = 'BOX-SKIP';
  state.samples.get('S2').boxPosition = 'A2';
  elements.boxPosition.value = 'A1';
  submitScan('S1');
  assert.equal(elements.boxPosition.value, 'A3');

  installElements({ boxName: makeElement('EMPTY-BOX'), boxPosition: makeElement('B2') });
  resetStateWithSamples(['S1']);
  const logCountBeforeEmptyFinish = state.scanLog.length;
  finishBox();
  assert.equal(elements.boxName.value, 'EMPTY-BOX');
  assert.equal(elements.boxPosition.value, 'B2');
  assert.equal(elements.cell.value, '1');
  assert.equal(state.scanLog.length, logCountBeforeEmptyFinish);
  assert.equal(elements.scanMessage.textContent, '当前盒没有扫码入库样本，不会保存当前盒，也不会切换盒号或冰箱位置。');

  installElements({ boxName: makeElement('BOX-NEW') });
  resetStateWithSamples(['OLD1', 'NEW1']);
  state.samples.get('OLD1').status = '已入库';
  state.samples.get('OLD1').boxName = 'BOX-OLD';
  state.samples.get('OLD1').boxPosition = 'A1';
  state.scanHistory = ['OLD1'];
  undoLastScan();
  assert.equal(state.samples.get('OLD1').status, '已入库');
  assert.equal(elements.scanMessage.textContent, '当前盒没有可撤回的扫码入库记录。');
  submitScan('NEW1');
  undoLastScan();
  assert.equal(state.samples.get('NEW1').status, '未入库');
  assert.equal(state.samples.get('OLD1').status, '已入库');
  assert.equal(elements.boxPosition.value, 'A1');

  console.log('app utility tests passed');
})();
