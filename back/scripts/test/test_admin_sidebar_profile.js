const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../../..');
const source = fs.readFileSync(path.join(root, 'front/js/admin/admin-common.js'), 'utf8');
const start = source.indexOf('function initializeAdminProfile()');
const end = source.indexOf('/* 컴포넌트 로드가 완료된 뒤 메뉴 초기화 */', start);
function render(session, local) {
    const elements = {
        adminProfileNickname: {textContent: '관리자'},
        adminProfileUsername: {textContent: '계정 정보 없음'},
        adminProfileAvatar: {textContent: 'A'},
    };
    const context = {
        document: {getElementById: id => elements[id]},
        sessionStorage: {getItem: () => session},
        localStorage: {getItem: () => local},
        console: {warn() {}},
    };
    vm.createContext(context);
    vm.runInContext(source.slice(start, end) + '\ninitializeAdminProfile();', context);
    return elements;
}
let result = render(JSON.stringify({nickname: '야구관리자', username: 'admin01'}), null);
assert.equal(result.adminProfileNickname.textContent, '야구관리자');
assert.equal(result.adminProfileUsername.textContent, 'admin01');
assert.equal(result.adminProfileAvatar.textContent, '야');
result = render(null, JSON.stringify({username: 'basebot'}));
assert.equal(result.adminProfileNickname.textContent, 'basebot');
assert.equal(result.adminProfileAvatar.textContent, 'B');
result = render('invalid json', null);
assert.equal(result.adminProfileNickname.textContent, '관리자');
result = render(JSON.stringify({nickname: '<img src=x onerror=alert(1)>', username: 'safe'}), null);
assert.equal(result.adminProfileNickname.textContent, '<img src=x onerror=alert(1)>');
assert.equal(result.adminProfileNickname.innerHTML, undefined);
assert.equal(render(null, null).adminProfileUsername.textContent, '계정 정보 없음');
console.log('Admin sidebar profile checks passed');
