// Run with: node tests/admin_fetch_test.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync("front/js/admin/admin-common.js", "utf8");
const helper = source.slice(source.indexOf("let adminAccessDenied"), source.indexOf("const adminAccessReady"));

function setup(token, status) {
    const calls = [], alerts = [];
    const storage = new Map(token ? [["access_token", token]] : []);
    const context = vm.createContext({
        Headers,
        sessionStorage: { getItem: key => storage.get(key), removeItem: key => storage.delete(key) },
        alert: message => alerts.push(message),
        window: { location: { href: "" } },
        fetch: async (url, options) => { calls.push({ url, options }); return { status, ok: status >= 200 && status < 300 }; },
    });
    vm.runInContext(helper, context);
    return { context, storage, calls, alerts, request: (options) => context.adminFetch("/admin/test", options) };
}

(async () => {
    const guest = setup(null, 200);
    await assert.rejects(guest.request());
    assert.equal(guest.calls.length, 0);
    assert.equal(guest.context.window.location.href, "/login.html");

    const user = setup("user", 403);
    await Promise.allSettled([user.request(), user.request(), user.request()]);
    assert.equal(user.alerts.length, 1);
    assert.equal(user.context.window.location.href, "/");
    assert.equal(user.storage.get("access_token"), "user");

    const expired = setup("expired", 401);
    await assert.rejects(expired.request());
    assert.equal(expired.storage.has("access_token"), false);

    const admin = setup("admin", 200);
    const response = await admin.request({ method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(response.status, 200);
    assert.equal(admin.calls[0].options.headers.get("Authorization"), "Bearer admin");
    assert.equal(admin.calls[0].options.headers.get("Content-Type"), "application/json");
    assert.equal(admin.calls[0].options.body, "{}");
    assert.equal(admin.alerts.length, 0);

    const failure = setup("admin", 500);
    assert.equal((await failure.request()).status, 500);
    assert.equal(failure.alerts.length, 0);

    const deniedPage = setup("user", 403);
    assert.equal(await deniedPage.context.verifyAdminAccess(), false);
    assert.equal(deniedPage.alerts.length, 1);
    assert.equal(deniedPage.context.window.location.href, "/");
    const adminPage = setup("admin", 200);
    assert.equal(await adminPage.context.verifyAdminAccess(), true);
    assert.equal(adminPage.calls[0].url, "/admin/users/access-check");
    const offlinePage = setup("admin", 500);
    assert.equal(await offlinePage.context.verifyAdminAccess(), false);
    assert.equal(offlinePage.alerts.length, 1);

    for (const name of ["baseball-data.js", "predictions.js"]) {
        assert.doesNotMatch(fs.readFileSync(`front/js/admin/${name}`, "utf8"), /\bfetch\(/);
    }
    console.log("Admin request checks passed: guest, user, expired token, admin, concurrent denial, server error");
})().catch(error => { console.error(error); process.exitCode = 1; });
