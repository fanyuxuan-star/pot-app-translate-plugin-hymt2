import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "main.js"), "utf8");
const translate = new Function(`${source}\nreturn translate;`)();

function success(content = "译文", finishReason = "stop") {
    return {
        ok: true,
        status: 200,
        data: {
            choices: [
                {
                    message: { content },
                    finish_reason: finishReason,
                },
            ],
        },
    };
}

function createHarness(config = {}, responder = () => success(), relayOnline = false) {
    const state = {
        calls: [],
        healthCalls: 0,
    };
    const http = {
        Body: {
            json(payload) {
                return { __bodyJson: payload };
            },
        },
    };
    const tauriFetch = async (url, options) => {
        if (url === "http://127.0.0.1:18766/health") {
            state.healthCalls += 1;
            return {
                ok: relayOnline,
                status: relayOnline ? 200 : 502,
                data: relayOnline ? '{"ok":true}' : "relay offline",
            };
        }
        state.calls.push({ url, options });
        return responder(url, options, state.calls.length);
    };

    return {
        state,
        options: {
            config,
            utils: { tauriFetch, http, osType: "Windows_NT" },
        },
    };
}

async function request(config, text = "Hello", from = "en", to = "zh", responder) {
    const harness = createHarness(config, responder);
    const result = await translate(text, from, to, harness.options);
    return { result, ...harness };
}

function payloadOf(call) {
    assert.ok(call.options.body && call.options.body.__bodyJson, "body should use Tauri Body.json");
    return call.options.body.__bodyJson;
}

// 1. Defaults: internal endpoint, model, official default prompt, official sampling params.
{
    const { result, state } = await request({ apiKey: "sk-test" });
    assert.equal(result, "译文");
    assert.equal(state.calls.length, 1);
    const call = state.calls[0];
    assert.equal(call.url, "http://10.200.8.204:9090/v1/chat/completions");
    assert.equal(call.options.method, "POST");
    assert.equal(call.options.headers.Authorization, "Bearer sk-test");
    assert.equal(call.options.headers["Content-Type"], "application/json");
    assert.equal(call.options.timeout, 120);
    assert.equal(call.options.responseType, 2);

    const payload = payloadOf(call);
    assert.equal(payload.model, "Hy-MT2-1.8B-FP8");
    assert.equal(payload.temperature, 0.7);
    assert.equal(payload.top_p, 0.6);
    assert.equal(payload.max_tokens, 2048);
    assert.equal(payload.stream, false);
    assert.deepEqual(payload.messages.map((item) => item.role), ["user"]);
    assert.equal(
        payload.messages[0].content,
        "将以下文本翻译为中文，注意只需要输出翻译后的结果，不要额外解释：\n\nHello"
    );
}

// 1b. When the local relay is healthy and no baseUrl is configured, use the
// WebView2 native fetch for 127.0.0.1 (not Tauri/reqwest, which honors the proxy).
{
    const nativeCalls = [];
    globalThis.window = {
        fetch: async (url, options) => {
            if (url === "http://127.0.0.1:18766/health") {
                return { ok: true, status: 200, text: async () => '{"ok":true}' };
            }
            nativeCalls.push({ url, options });
            return {
                ok: true,
                status: 200,
                text: async () =>
                    JSON.stringify({
                        choices: [{ message: { content: "译文" }, finish_reason: "stop" }],
                    }),
            };
        },
    };
    try {
        const harness = createHarness({ apiKey: "sk-test" });
        const result = await translate("Hello", "en", "zh", harness.options);
        assert.equal(result, "译文");
        assert.equal(harness.state.calls.length, 0);
        assert.equal(nativeCalls.length, 1);
        assert.equal(nativeCalls[0].url, "http://127.0.0.1:18766/v1/chat/completions");
        const payload = JSON.parse(nativeCalls[0].options.body);
        assert.equal(payload.model, "Hy-MT2-1.8B-FP8");
        assert.equal(payload.messages[0].content.includes("Hello"), true);
    } finally {
        delete globalThis.window;
    }
}

// 1b2. If the relay is down, the plugin starts the bundled relay and retries.
{
    let healthChecks = 0;
    const runCalls = [];
    const nativeCalls = [];
    globalThis.window = {
        fetch: async (url, options) => {
            if (url === "http://127.0.0.1:18766/health") {
                healthChecks += 1;
                return {
                    ok: healthChecks > 1,
                    status: healthChecks > 1 ? 200 : 502,
                };
            }
            nativeCalls.push({ url, options });
            return {
                ok: true,
                status: 200,
                text: async () =>
                    JSON.stringify({
                        choices: [{ message: { content: "你好" }, finish_reason: "stop" }],
                    }),
            };
        },
    };
    try {
        const harness = createHarness({ apiKey: "sk-test" });
        harness.options.utils.run = async (command, args) => {
            runCalls.push({ command, args });
            return { status: 0 };
        };
        const result = await translate("Hello", "en", "zh", harness.options);
        assert.equal(result, "你好");
        assert.equal(healthChecks, 2);
        assert.equal(runCalls.length, 1);
        assert.match(runCalls[0].command, /wscript\.exe$/);
        assert.match(runCalls[0].args[0], /start-relay\.vbs$/);
        assert.equal(nativeCalls.length, 1);
    } finally {
        delete globalThis.window;
    }
}

// 1c. An explicit baseUrl always wins over the relay.
{
    const harness = createHarness(
        { apiKey: "sk-test", baseUrl: "http://direct.example.com/v1" },
        () => success(),
        true
    );
    await translate("Hello", "en", "zh", harness.options);
    assert.equal(harness.state.healthCalls, 0);
    assert.equal(harness.state.calls[0].url, "http://direct.example.com/v1/chat/completions");
}

// 2. Custom endpoint, model, Bearer key, legal domain, hint and glossary.
{
    const { state } = await request({
        apiKey: "Bearer abc",
        baseUrl: "http://192.168.1.5:8000/v1/",
        model: "Hy-MT2-7B-FP8",
        domain: "legal",
        domainHint: "称呼统一使用“甲方”",
        glossary: "Cloud Native=云原生; Load Balancer=>负载均衡",
    });
    const call = state.calls[0];
    assert.equal(call.url, "http://192.168.1.5:8000/v1/chat/completions");
    assert.equal(call.options.headers.Authorization, "Bearer abc");

    const payload = payloadOf(call);
    assert.equal(payload.model, "Hy-MT2-7B-FP8");
    assert.match(payload.messages[0].content, /法律领域/);
    assert.match(payload.messages[0].content, /称呼统一使用“甲方”/);
    assert.match(payload.messages[0].content, /Cloud Native 翻译成 云原生/);
    assert.match(payload.messages[0].content, /Load Balancer 翻译成 负载均衡/);
    assert.match(payload.messages[0].content, /将【待翻译文本】翻译为中文/);
    assert.match(payload.messages[0].content, /1、这是法律领域/);
    assert.match(payload.messages[0].content, /4、将【待翻译文本】/);
}

// 2b. Duplicate glossary items keep the last value; lowercase bearer is normalized.
{
    const { state } = await request({
        apiKey: "bearer lowercase-key",
        glossary: "API=接口;API=应用程序接口",
    });
    const call = state.calls[0];
    assert.equal(call.options.headers.Authorization, "bearer lowercase-key");
    const prompt = payloadOf(call).messages[0].content;
    assert.match(prompt, /API 翻译成 应用程序接口/);
    assert.doesNotMatch(prompt, /API 翻译成 接口/);
}

// 3. Base URL without /v1 and without a scheme gets the OpenAI path.
{
    const { state } = await request({
        apiKey: "sk-test",
        baseUrl: "10.0.0.1:9090/v1",
    });
    assert.equal(state.calls[0].url, "http://10.0.0.1:9090/v1/chat/completions");
}

// 4. A full /chat/completions URL is used as-is.
{
    const { state } = await request({
        apiKey: "sk-test",
        baseUrl: "https://gateway.example.com/openai/v1/chat/completions",
    });
    assert.equal(
        state.calls[0].url,
        "https://gateway.example.com/openai/v1/chat/completions"
    );
}

// 5. Traditional Chinese target name.
{
    const { state } = await request({ apiKey: "sk-test" }, "Hello", "en", "zh-Hant");
    assert.match(payloadOf(state.calls[0]).messages[0].content, /翻译为繁体中文/);
}

// 6. Surrounding English and Chinese quotes are removed.
{
    const { result } = await request({ apiKey: "sk-test" }, "Hello", "en", "zh", () =>
        success('"你好"')
    );
    assert.equal(result, "你好");

    const second = await request({ apiKey: "sk-test" }, "Hello", "en", "zh", () =>
        success("“你好”")
    );
    assert.equal(second.result, "你好");
}

// 7. Array-shaped OpenAI content is supported.
{
    const { result } = await request({ apiKey: "sk-test" }, "Hello", "en", "zh", () => ({
        ok: true,
        status: 200,
        data: {
            choices: [
                {
                    message: {
                        content: [
                            { type: "text", text: "你" },
                            { type: "text", text: "好" },
                        ],
                    },
                    finish_reason: "stop",
                },
            ],
        },
    }));
    assert.equal(result, "你好");
}

// 7b. Tauri Text response is parsed as JSON on success.
{
    const { result } = await request({ apiKey: "sk-test" }, "Hello", "en", "zh", () => ({
        ok: true,
        status: 200,
        data: JSON.stringify({
            choices: [{ message: { content: "你好" }, finish_reason: "stop" }],
        }),
    }));
    assert.equal(result, "你好");
}

// 7c. Non-JSON success bodies produce a readable error.
{
    const harness = createHarness({ apiKey: "sk-test" }, () => ({
        ok: true,
        status: 200,
        data: "<html>gateway error</html>",
    }));
    await assert.rejects(
        () => translate("Hello", "en", "zh", harness.options),
        /非 JSON 响应/
    );
}

// 8. 401 turns into an actionable Chinese error while preserving server detail.
{
    const harness = createHarness({ apiKey: "bad-key" }, () => ({
        ok: false,
        status: 401,
        data: { error: { message: "invalid api key" } },
    }));
    await assert.rejects(
        () => translate("Hello", "en", "zh", harness.options),
        (error) => {
            assert.match(String(error), /HTTP 401/);
            assert.match(String(error), /API Key 无效/);
            assert.match(String(error), /invalid api key/);
            return true;
        }
    );
}

// 8b. 401 with a plain-text body still shows the gateway detail.
{
    const harness = createHarness({ apiKey: "bad-key" }, () => ({
        ok: false,
        status: 401,
        data: "无效的令牌",
    }));
    await assert.rejects(
        () => translate("Hello", "en", "zh", harness.options),
        (error) => {
            assert.match(String(error), /HTTP 401/);
            assert.match(String(error), /无效的令牌/);
            return true;
        }
    );
}

// 8c. On error the plugin expands Pot's collapsed result card via setResult("").
{
    const harness = createHarness({ apiKey: "bad-key" }, () => ({
        ok: false,
        status: 401,
        data: "无效的令牌",
    }));
    const setResultCalls = [];
    harness.options.setResult = (value) => setResultCalls.push(value);
    await assert.rejects(() => translate("Hello", "en", "zh", harness.options));
    assert.deepEqual(setResultCalls, [""]);
}

// 9. Missing API key is rejected before a request is made.
{
    const harness = createHarness({});
    await assert.rejects(
        () => translate("Hello", "en", "zh", harness.options),
        /请先在 Pot 的插件设置中填写 API Key/
    );
    assert.equal(harness.state.calls.length, 0);
}

// 10. Invalid glossary reports the offending item.
{
    const harness = createHarness({
        apiKey: "sk-test",
        glossary: "Cloud Native=云原生;not-a-pair",
    });
    await assert.rejects(
        () => translate("Hello", "en", "zh", harness.options),
        /术语表格式不正确/
    );
}

// 11. Oversized input is rejected with a clear limit.
{
    const harness = createHarness({ apiKey: "sk-test" });
    await assert.rejects(
        () => translate("a".repeat(4001), "en", "zh", harness.options),
        /文本过长/
    );
}

// 12. Truncated output is not silently returned.
{
    const harness = createHarness({ apiKey: "sk-test" }, () => success("部分译文", "length"));
    await assert.rejects(
        () => translate("Hello", "en", "zh", harness.options),
        /译文达到输出上限而被截断/
    );
}

// 13. Empty choices and empty content are rejected.
{
    const noChoices = createHarness({ apiKey: "sk-test" }, () => ({
        ok: true,
        status: 200,
        data: { choices: [] },
    }));
    await assert.rejects(
        () => translate("Hello", "en", "zh", noChoices.options),
        /无法识别的结果/
    );

    const empty = createHarness({ apiKey: "sk-test" }, () => success("   "));
    await assert.rejects(
        () => translate("Hello", "en", "zh", empty.options),
        /空译文/
    );
}

// 14. Network failures include the endpoint but not the API key.
{
    const harness = createHarness({ apiKey: "sk-secret" }, () => {
        throw new Error("connection refused");
    });
    await assert.rejects(
        () => translate("Hello", "en", "zh", harness.options),
        (error) => {
            assert.match(String(error), /无法连接翻译服务/);
            assert.match(String(error), /10\.200\.8\.204/);
            assert.match(String(error), /connection refused/);
            assert.doesNotMatch(String(error), /sk-secret/);
            return true;
        }
    );
}

console.log("All tests passed.");
