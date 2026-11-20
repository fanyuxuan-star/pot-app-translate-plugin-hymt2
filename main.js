async function translate(text, from, to, options) {
    try {
        return await hymt2TranslateInternal(text, from, to, options);
    } catch (error) {
        // Pot 3.x 的错误文本在结果卡片里，而卡片无结果时默认折叠。
        // 这里先触发一次空 setResult，让卡片展开，红色错误信息才可见。
        if (options && typeof options.setResult === "function") {
            try {
                options.setResult("");
            } catch (ignored) {
                // 忽略宿主回调异常，保留原始翻译错误。
            }
        }
        throw error;
    }
}

async function hymt2TranslateInternal(text, from, to, options) {
    "use strict";

    const config = (options && options.config) || {};
    const utils = (options && options.utils) || {};
    const fetch = utils.tauriFetch || (utils.http && utils.http.fetch);
    const nativeFetch =
        typeof window !== "undefined" && typeof window.fetch === "function"
            ? window.fetch.bind(window)
            : null;

    if (typeof fetch !== "function") {
        throw "[Hy-MT2] 插件运行环境缺少 HTTP 客户端，请升级 Pot 后重试。";
    }

    const DEFAULT_BASE_URL = "http://10.200.8.204:9090/v1";
    const RELAY_BASE_URL = "http://127.0.0.1:18766/v1";
    const RELAY_HEALTH_URL = "http://127.0.0.1:18766/health";
    const DEFAULT_MODEL = "Hy-MT2-1.8B-FP8";
    const MAX_INPUT_CHARS = 3000;
    const CONTEXT_TOKENS = 4096;
    const MAX_OUTPUT_TOKENS = 2048;
    const MAX_GLOSSARY_ITEMS = 80;
    const MAX_GLOSSARY_CHARS = 2000;

    // Pot 会把 info.json 中 language 的 value 传给插件。
    const LANGUAGE_ALIASES = {
        zh_cn: "zh",
        zh_hans: "zh",
        "zh-cn": "zh",
        "zh-hans": "zh",
        zh_tw: "zh-Hant",
        "zh-tw": "zh-Hant",
        "zh-hant": "zh-Hant",
        pt_pt: "pt",
        pt_br: "pt",
        mn_cy: "mn",
        mn_mo: "mn",
    };

    const LANGUAGE_NAMES = {
        zh: "中文",
        "zh-Hant": "繁体中文",
        en: "英语",
        ja: "日语",
        ko: "韩语",
        fr: "法语",
        es: "西班牙语",
        ru: "俄语",
        de: "德语",
        it: "意大利语",
        tr: "土耳其语",
        pt: "葡萄牙语",
        vi: "越南语",
        id: "印尼语",
        th: "泰语",
        ms: "马来语",
        ar: "阿拉伯语",
        hi: "印地语",
        km: "高棉语",
        mn: "蒙古语",
        fa: "波斯语",
        pl: "波兰语",
        nl: "荷兰语",
        uk: "乌克兰语",
        he: "希伯来语",
        // 以下语种 Pot 当前界面暂未开放，保留以便后续兼容。
        yue: "粤语",
        bo: "藏语",
        kk: "哈萨克语",
        ug: "维吾尔语",
        tl: "菲律宾语",
        gu: "古吉拉特语",
        ur: "乌尔都语",
        te: "泰卢固语",
        mr: "马拉地语",
        bn: "孟加拉语",
        ta: "泰米尔语",
        cs: "捷克语",
        my: "缅甸语",
    };

    // 官方没有“领域”专用模板；这里用官方 Personalization + Terminology
    // 模板表达领域约束，模型本身在 DomainMTBench 上做过领域翻译优化。
    const DOMAINS = {
        general: {
            label: "通用",
            instruction: "",
        },
        legal: {
            label: "法律 / 合同",
            instruction:
                "这是法律领域的文本。请使用严谨、规范的法律术语，保持条文和权利义务的精确性，不增删条件、主体或责任关系。",
        },
        medical: {
            label: "医疗 / 医药",
            instruction:
                "这是医疗健康领域的文本。请使用规范的医学术语，准确翻译疾病、症状、药物、检查、剂量和解剖名称，避免口语化表达。",
        },
        finance: {
            label: "金融 / 财务",
            instruction:
                "这是金融财务领域的文本。请使用规范的金融术语，准确处理金额、比率、日期、机构、产品和监管名称，保持正式语气。",
        },
        tech: {
            label: "计算机 / 软件",
            instruction:
                "这是计算机与软件技术领域的文本。请使用业界通行译法，保持技术表述准确；代码、变量、函数、命令、路径、URL、标签和占位符保持原样，不要翻译。",
        },
        government: {
            label: "政务 / 公文",
            instruction:
                "这是政务公文领域的文本。请使用规范、庄重、简洁的公文语体，确保政策表述和机构名称准确。",
        },
        academic: {
            label: "学术 / 论文",
            instruction:
                "这是学术领域的文本。请使用规范的学术术语和客观严谨的表述，保留公式、变量、引用编号和文献格式。",
        },
        game: {
            label: "游戏本地化",
            instruction:
                "这是游戏本地化领域的文本。请符合游戏语境和角色语气，技能、道具和 UI 术语前后一致，表达简洁自然。",
        },
        literature: {
            label: "文学 / 出版",
            instruction:
                "这是文学出版领域的文本。请保留原文的风格、修辞和情感色彩，译文自然流畅，避免机械直译。",
        },
        ecommerce: {
            label: "电商 / 营销",
            instruction:
                "这是电商营销领域的文本。请符合目标市场的表达习惯，卖点清晰、有吸引力；品牌名、型号和规格按原文保留。",
        },
        custom: {
            label: "自定义领域",
            instruction:
                "这是专业领域的文本。请根据内容判断所属领域，使用该领域规范的专业术语和表达习惯。",
        },
    };

    function getConfig(key) {
        const value = config[key];
        return typeof value === "string" ? value.trim() : "";
    }

    function buildEndpoint(rawBaseUrl) {
        let endpoint = rawBaseUrl || DEFAULT_BASE_URL;
        if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(endpoint)) {
            endpoint = `http://${endpoint}`;
        }
        endpoint = endpoint.replace(/\/+$/, "");

        if (!/^https?:\/\//i.test(endpoint)) {
            throw "[Hy-MT2] 请求地址只支持 http:// 或 https://。";
        }
        if (/\/chat\/completions$/i.test(endpoint)) {
            return endpoint;
        }
        if (/\/v1$/i.test(endpoint)) {
            return `${endpoint}/chat/completions`;
        }
        return `${endpoint}/v1/chat/completions`;
    }

    async function relayAvailable() {
        // 必须用 WebView2 原生 fetch：127.0.0.1 在系统代理绕过列表中，
        // 而 Tauri 的 reqwest 在这台机器上仍会把内网 IP 交给 mihomo。
        if (!nativeFetch) {
            return false;
        }
        const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
        const timer = controller ? setTimeout(() => controller.abort(), 800) : null;
        try {
            const response = await nativeFetch(RELAY_HEALTH_URL, {
                method: "GET",
                signal: controller ? controller.signal : undefined,
            });
            return !!(response && response.ok);
        } catch (error) {
            return false;
        } finally {
            if (timer) {
                clearTimeout(timer);
            }
        }
    }

    async function startRelay() {
        if (
            !nativeFetch ||
            utils.osType !== "Windows_NT" ||
            typeof utils.run !== "function"
        ) {
            return false;
        }
        try {
            // 中继脚本随插件一起安装，run_binary 的 current_dir 就是插件目录。
            await utils.run("C:\\Windows\\System32\\wscript.exe", ["relay\\start-relay.vbs"]);
        } catch (error) {
            return false;
        }
        for (let attempt = 0; attempt < 4; attempt += 1) {
            await new Promise((resolve) => setTimeout(resolve, 300));
            if (await relayAvailable()) {
                return true;
            }
        }
        return false;
    }

    async function ensureRelay() {
        if (await relayAvailable()) {
            return true;
        }
        return await startRelay();
    }

    function getLanguageName(code) {
        const raw = String(code || "").trim();
        const normalized = LANGUAGE_ALIASES[raw] || LANGUAGE_ALIASES[raw.toLowerCase()] || raw;
        return LANGUAGE_NAMES[normalized] || LANGUAGE_NAMES[normalized.toLowerCase()] || "";
    }

    function parseGlossary(raw) {
        if (!raw) {
            return [];
        }
        if (raw.length > MAX_GLOSSARY_CHARS) {
            throw `[Hy-MT2] 术语表过长（${raw.length} 字符），最多 ${MAX_GLOSSARY_CHARS} 字符，请精简后重试。`;
        }

        const entries = new Map();
        const parts = raw.split(/[;；\n\r]+/);

        for (const part of parts) {
            const item = part.trim();
            if (!item) {
                continue;
            }

            const match = item.match(/^(.+?)\s*(?:=>|->|→|＝|=)\s*(.+)$/);
            if (!match) {
                throw `[Hy-MT2] 术语表格式不正确：“${item}”。请使用“原文=译文”，多条用分号隔开。`;
            }

            const source = match[1].trim();
            const target = match[2].trim();
            if (!source || !target) {
                throw `[Hy-MT2] 术语表条目不完整：“${item}”。请使用“原文=译文”。`;
            }
            entries.set(source, target);

            if (entries.size > MAX_GLOSSARY_ITEMS) {
                throw `[Hy-MT2] 术语表最多支持 ${MAX_GLOSSARY_ITEMS} 条，请精简后重试。`;
            }
        }

        return Array.from(entries.entries());
    }

    function buildPrompt(sourceText, targetName) {
        const configuredDomain = getConfig("domain");
        const domainKey = DOMAINS[configuredDomain] ? configuredDomain : "general";
        const domain = DOMAINS[domainKey];
        const domainHint = getConfig("domainHint");
        const glossary = parseGlossary(getConfig("glossary"));

        if (domainKey === "general" && !domainHint && glossary.length === 0) {
            // Hy-MT2 官方默认翻译模板。
            return `将以下文本翻译为${targetName}，注意只需要输出翻译后的结果，不要额外解释：\n\n${sourceText}`;
        }

        const tasks = [];
        if (domain.instruction) {
            tasks.push(domain.instruction);
        }
        if (domainHint) {
            tasks.push(domainHint);
        }
        tasks.push(
            "保留原文的段落、换行、数字、URL、代码片段和占位符；不要翻译代码、标签、变量名或链接地址。"
        );
        tasks.push(`将【待翻译文本】翻译为${targetName}，只输出译文，不要额外解释。`);

        let prompt = "";
        if (glossary.length > 0) {
            prompt += "参考下面的翻译：\n";
            prompt += glossary.map(([source, target]) => `${source} 翻译成 ${target}`).join("\n");
            prompt += "\n\n";
        }

        prompt += `【待翻译文本】\n${sourceText}\n\n【翻译任务】\n`;
        prompt += tasks.map((task, index) => `${index + 1}、${task}`).join("\n");
        return prompt;
    }

    function describeError(data) {
        if (data === undefined || data === null || data === "") {
            return "";
        }
        if (typeof data === "string") {
            try {
                const parsed = JSON.parse(data);
                if (parsed && typeof parsed === "object") {
                    return describeError(parsed);
                }
            } catch (error) {
                // 不是 JSON，直接展示原始文本。
            }
            return data.slice(0, 1000);
        }

        const error = data.error || data;
        const message = error.message || error.msg || error.detail || data.message;
        if (typeof message === "string") {
            return message.slice(0, 1000);
        }

        try {
            return JSON.stringify(data).slice(0, 1000);
        } catch (error) {
            return String(data).slice(0, 1000);
        }
    }

    function getContent(choice) {
        if (!choice) {
            return "";
        }
        if (choice.message) {
            const content = choice.message.content;
            if (typeof content === "string") {
                return content;
            }
            if (Array.isArray(content)) {
                return content
                    .map((part) => {
                        if (typeof part === "string") {
                            return part;
                        }
                        if (part && typeof part.text === "string") {
                            return part.text;
                        }
                        return "";
                    })
                    .join("");
            }
        }
        return typeof choice.text === "string" ? choice.text : "";
    }

    function cleanResult(raw) {
        let result = raw.trim();
        if (
            (result.startsWith('"') && result.endsWith('"')) ||
            (result.startsWith("“") && result.endsWith("”"))
        ) {
            result = result.slice(1, -1).trim();
        }
        return result;
    }

    const sourceText = String(text === undefined || text === null ? "" : text);
    if (!sourceText.trim()) {
        throw "[Hy-MT2] 没有可翻译的文本。";
    }
    if (sourceText.length > MAX_INPUT_CHARS) {
        throw `[Hy-MT2] 文本过长（${sourceText.length} 字符），当前插件单次最多 ${MAX_INPUT_CHARS} 字符，请分段翻译。`;
    }

    const targetName = getLanguageName(to);
    if (!targetName) {
        throw `[Hy-MT2] 暂不支持目标语言：${to}。请在 info.json 的 language 映射中选择受支持的语种。`;
    }

    const apiKey = getConfig("apiKey");
    if (!apiKey) {
        throw "[Hy-MT2] 请先在 Pot 的插件设置中填写 API Key。";
    }

    const configuredBaseUrl = getConfig("baseUrl");
    let endpoint;
    let useRelay = false;
    if (configuredBaseUrl) {
        endpoint = buildEndpoint(configuredBaseUrl);
    } else if (await ensureRelay()) {
        // 系统代理会拦截内网 IP 时，优先走本机中继；中继不在时尝试启动插件自带的中继。
        useRelay = true;
        endpoint = buildEndpoint(RELAY_BASE_URL);
    } else {
        endpoint = buildEndpoint(DEFAULT_BASE_URL);
    }
    const model = getConfig("model") || DEFAULT_MODEL;
    const prompt = buildPrompt(sourceText, targetName);

    // 这个内网部署的 max_model_len 是 4096：输入 + 输出必须同时放进去。
    // 用 prompt 字符数做保守估算，避免再出现“4096 输出 + 输入 > 4096”的 400。
    if (prompt.length + 256 >= CONTEXT_TOKENS) {
        throw `[Hy-MT2] 提示词过长（${prompt.length} 字符），超过该部署的 ${CONTEXT_TOKENS} token 上下文，请缩短文本或术语表。`;
    }
    const maxTokens = Math.min(
        MAX_OUTPUT_TOKENS,
        Math.max(192, CONTEXT_TOKENS - prompt.length - 256)
    );

    const payload = {
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
        top_p: 0.6,
        max_tokens: maxTokens,
        stream: false,
    };

    const headers = {
        "Content-Type": "application/json",
        Authorization: /^Bearer\s+/i.test(apiKey) ? apiKey : `Bearer ${apiKey}`,
    };

    const Body = utils.http && utils.http.Body;
    const body =
        Body && typeof Body.json === "function" ? Body.json(payload) : JSON.stringify(payload);

    let response;
    try {
        if (useRelay && nativeFetch) {
            const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
            const timer = controller ? setTimeout(() => controller.abort(), 120000) : null;
            try {
                const nativeResponse = await nativeFetch(endpoint, {
                    method: "POST",
                    headers,
                    body: JSON.stringify(payload),
                    signal: controller ? controller.signal : undefined,
                });
                response = {
                    ok: nativeResponse.ok,
                    status: nativeResponse.status,
                    data: await nativeResponse.text(),
                };
            } finally {
                if (timer) {
                    clearTimeout(timer);
                }
            }
        } else {
            response = await fetch(endpoint, {
                method: "POST",
                headers,
                body,
                timeout: 120,
                // Text + 手动 JSON.parse：网关返回非 JSON 错误页时也能显示真实状态码和内容。
                responseType: 2,
            });
        }
    } catch (error) {
        const detail = error && error.message ? error.message : String(error);
        throw `[Hy-MT2] 无法连接翻译服务：${endpoint}\n${detail}\n请检查请求地址、网络或代理设置。`;
    }

    if (!response || !response.ok) {
        const status = response ? response.status : "unknown";
        let message = `[Hy-MT2] 请求失败：HTTP ${status}`;
        if (status === 401) {
            message += "。API Key 无效或未被该渠道授权。";
        } else if (status === 403) {
            message += "。该 API Key 没有访问此模型的权限。";
        } else if (status === 404) {
            message += "。请检查请求地址是否以 /v1 结尾，以及模型名是否正确。";
        } else if (status === 429) {
            message += "。请求过于频繁或额度不足，请稍后重试。";
        } else if (typeof status === "number" && status >= 500) {
            message += "。翻译服务端异常，请稍后重试或联系服务管理员。";
        }

        const detail = describeError(response ? response.data : "");
        if (detail) {
            message += `\n${detail}`;
        }
        throw message;
    }

    let data = response.data;
    if (typeof data === "string") {
        try {
            data = JSON.parse(data);
        } catch (error) {
            throw `[Hy-MT2] 服务返回了非 JSON 响应：${data.slice(0, 500)}`;
        }
    }

    const choices = data && data.choices;
    const choice = choices && choices[0];
    if (!choice) {
        const detail = describeError(data);
        throw `[Hy-MT2] 服务返回了无法识别的结果。${detail ? `\n${detail}` : ""}`;
    }

    if (choice.finish_reason === "length" || choice.finish_reason === "max_tokens") {
        throw "[Hy-MT2] 译文达到输出上限而被截断，请缩短文本或分段翻译。";
    }

    const result = cleanResult(getContent(choice));
    if (!result) {
        throw "[Hy-MT2] 服务返回了空译文，请重试或检查模型是否正常加载。";
    }

    return result;
}
