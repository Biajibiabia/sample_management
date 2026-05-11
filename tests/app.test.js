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
  formatSampleFullLocation,
  formatBoxSpec,
  incrementBoxPosition,
  normaliseBoxPosition,
  normaliseHeader,
  normaliseId,
  parseDelimitedText,
  rowsToSampleIds,
  rowsToSampleRecords,
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
assert.equal(formatSampleFullLocation({
  id: 'S-1',
  status: '已入库',
  location: { freezer: '001', shelf: '2', column: '3', drawer: '4', cell: '5' },
  boxName: 'BOX-001',
  boxSize: 9,
  boxPosition: 'B2',
}), '冰箱001 / 从上到下第2层 / 从左到右第3列 / 从上到下第4抽箱 / 从外到内第5格 / 盒子BOX-001 / 9×9规格 / 盒内B2');

console.log('app utility tests passed');
