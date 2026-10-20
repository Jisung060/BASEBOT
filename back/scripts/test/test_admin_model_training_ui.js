const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');
const root = path.resolve(__dirname, '../../..');
const source = fs.readFileSync(path.join(root, 'front/js/admin/baseball-data.js'), 'utf8');
const body = source.slice(source.indexOf('function initManualSyncControls()'), source.indexOf('let logPollTimer'));
const elements = {};
const get = id => elements[id] ||= {value: '', style: {}, handlers: {}, addEventListener(e, f) {this.handlers[e] = f;}};
let payload;
const context = {document: {getElementById: get}, executeManualSync(p) {payload = p;}, saveSchedulesConfig() {}, loadSyncLogs() {}, loadDashboardSummary() {}};
vm.createContext(context);
vm.runInContext(body + '\ninitManualSyncControls();', context);
for (const type of ['TRAIN_ML_MODEL', 'TRAIN_DL_MODEL']) {
 get('manualSyncType').value = type;
 get('manualSyncType').handlers.change();
 for (const id of ['manualSeasonBox', 'manualStartDateBox', 'manualEndDateBox']) assert.equal(get(id).style.display, 'none');
 assert.equal(get('manualTrainingNotice').style.display, 'block');
 get('btnRunManualSync').handlers.click();
 assert.equal(payload.data_type, type);
}
get('manualSyncType').value = 'STEP_SAVANT_REPAIR';
get('manualSyncType').handlers.change();
assert.equal(get('manualSeasonBox').style.display, 'flex');
assert.equal(get('manualTrainingNotice').style.display, 'none');
const html = fs.readFileSync(path.join(root, 'front/pages/admin/baseball-data.html'), 'utf8');
assert.match(html, /<optgroup label="머신러닝\/딥러닝 모델 학습 스크립트 실행">/);
for (const type of ['TRAIN_ML_MODEL', 'TRAIN_DL_MODEL']) assert.ok(html.includes(`value="${type}"`));
console.log('Model training controls and payload checks passed');
