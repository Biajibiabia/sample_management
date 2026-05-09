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

const { normaliseId, rowsToSampleIds, parseDelimitedText, formatLocation } = sandbox.module.exports;

assert.equal(normaliseId('  SAMPLE-001\n'), 'SAMPLE-001');
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
assert.equal(JSON.stringify(parseDelimitedText('样本编号\nA001\nA002')), JSON.stringify([['样本编号'], ['A001'], ['A002']]));
assert.equal(JSON.stringify(parseDelimitedText('样本编号,姓名\nA001,张三')), JSON.stringify([['样本编号', '姓名'], ['A001', '张三']]));
assert.equal(formatLocation({ freezer: '001', shelf: '2', column: '3', drawer: '4', cell: '5' }), '冰箱001 / 2层 / 3列 / 4抽箱 / 5格');

console.log('app utility tests passed');
