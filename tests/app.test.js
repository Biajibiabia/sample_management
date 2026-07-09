const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');
const sandbox = {
  module: { exports: {} },
  document: undefined,
  window: {},
};
vm.createContext(sandbox);
vm.runInContext(appSource, sandbox);

const {
  SAMPLE_ID_HEADERS,
  formatLocation,
  formatStorageCode,
  formatStorageShortLocation,
  formatDrawerShortLocation,
  formatSampleFullLocation,
  formatBoxSpec,
  incrementBoxPosition,
  getNextFreezerLocation,
  findNextAvailablePosition,
  normaliseBoxPosition,
  normaliseHeader,
  normaliseId,
  parseDelimitedText,
  rowsToSampleIds,
  rowsToSampleRecords,
  EXPORT_BASE_HEADERS,
  createDefaultStorageSpaces,
  getBoxKeyFromParts,
  serialiseSample,
  parseImportedLocation,
  normaliseFreezerLocation,
  formatExcelSerialDate,
} = sandbox.module.exports;

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
assert.equal(formatStorageCode({ freezer: '001', shelf: '3', column: '3', drawer: '2', cell: '4' }), '3C-2抽4格');
assert.equal(formatStorageShortLocation({ freezer: '001', shelf: '3', column: '3', drawer: '2', cell: '4' }), '冰箱001 · 3层 · C列 · 2号抽箱 · 4号格子');
assert.equal(formatDrawerShortLocation({ freezer: '001', shelf: '3', column: '3', drawer: '2', cell: '4' }), '冰箱001 · 3层 · C列 · 2号抽箱');
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
assert.equal(findNextAvailablePosition([], 'A1', 10), 'A1');
assert.equal(findNextAvailablePosition(['A1'], 'A1', 10), 'A2');
assert.equal(findNextAvailablePosition(['A1', 'A2', 'A3'], 'A1', 10), 'A4');
assert.equal(findNextAvailablePosition(['A1', 'A2'], 'A2', 10), 'A3');
assert.equal(findNextAvailablePosition(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9'], 'A1', 9), 'B1');
assert.equal(findNextAvailablePosition(['I9'], 'I9', 9), '');
assert.equal(JSON.stringify(getNextFreezerLocation({ freezer: '001', shelf: '1', column: '1', drawer: '1', cell: '1' })), JSON.stringify({ freezer: '001', shelf: '1', column: '1', drawer: '1', cell: '2' }));
assert.equal(JSON.stringify(getNextFreezerLocation({ freezer: '001', shelf: '1', column: '1', drawer: '1', cell: '5' })), JSON.stringify({ freezer: '001', shelf: '1', column: '1', drawer: '2', cell: '1' }));
assert.equal(JSON.stringify(getNextFreezerLocation({ freezer: '001', shelf: '1', column: '1', drawer: '5', cell: '5' })), JSON.stringify({ freezer: '001', shelf: '1', column: '2', drawer: '1', cell: '1' }));
assert.equal(JSON.stringify(getNextFreezerLocation({ freezer: '001', shelf: '4', column: '5', drawer: '5', cell: '5' })), JSON.stringify({ freezer: '002', shelf: '1', column: '1', drawer: '1', cell: '1' }));
assert.equal(getNextFreezerLocation({ freezer: '002', shelf: '4', column: '5', drawer: '5', cell: '5' }), null);
assert.equal(JSON.stringify(EXPORT_BASE_HEADERS), JSON.stringify(['样本编号', '条码', '入库状态', '样本类型', '样本来源', '原测序组学', '返回公司', '冰箱', '层架', '列', '抽箱', '格子', '盒号', '样本盒规格', '盒内位置', '完整位置', '扫码时间', '盒子标注编号', '样本余量(μL)', '操作员']));
assert.equal(createDefaultStorageSpaces().length, 1000);
assert.equal(JSON.stringify(normaliseFreezerLocation({ freezer: '1', shelf: '4', column: '5', drawer: '5', cell: '5' })), JSON.stringify({ freezer: '001', shelf: '4', column: '5', drawer: '5', cell: '5' }));
assert.equal(normaliseFreezerLocation({ freezer: '003', shelf: '1', column: '1', drawer: '1', cell: '1' }), null);
assert.equal(JSON.stringify(parseImportedLocation({ originalData: { '冰箱编号(001/002)': '002', '层架序号(从上到下1-4)': '3', '列序号(从左到右1-5)': '2', '抽箱序号(每列从上到下1-5)': '4', '格子序号(每抽箱从外到内1-5)': '5' } })), JSON.stringify({ freezer: '002', shelf: '3', column: '2', drawer: '4', cell: '5' }));
assert.match(formatExcelSerialDate(46183.5854166667), /^2026\/6\/10 14:03/);
assert.equal(getBoxKeyFromParts('BOX-1', { freezer: '001', shelf: '1', column: '2', drawer: '3', cell: '4' }), '001|1|2|3|4|BOX-1');
const compactSample = serialiseSample({ id: 'S-compact', barcode: 'BC-compact', status: '未入库', originalData: { 备注: '大量原始字段' } }, true);
assert.equal(compactSample.id, 'S-compact');
assert.equal(compactSample.barcode, 'BC-compact');
assert.equal(compactSample.originalData, undefined);
assert.equal(formatSampleFullLocation({
  id: 'S-1',
  status: '已入库',
  location: { freezer: '001', shelf: '2', column: '3', drawer: '4', cell: '5' },
  boxName: 'BOX-001',
  boxSize: 9,
  boxPosition: 'B2',
}), '冰箱001 / 从上到下第2层 / 从左到右第3列 / 从上到下第4抽箱 / 从外到内第5格 / 盒子BOX-001 / 9×9规格 / 盒内B2');

console.log('app utility tests passed');
