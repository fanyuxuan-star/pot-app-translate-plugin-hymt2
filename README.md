# Pot-App Hy-MT2 内网翻译插件

为 [Pot](https://github.com/pot-app/pot-desktop) 编写的 OpenAI 兼容翻译插件，默认对接公司内网部署的 **Hy-MT2-1.8B-FP8**，支持自定义请求地址、模型名、API Key、翻译领域和术语表。

## 功能

- 自定义 OpenAI 兼容渠道：请求地址、API Key、模型名均可配置。
- 默认配置：`http://10.200.8.204:9090/v1` + `Hy-MT2-1.8B-FP8`。
- 领域翻译：通用、法律、医疗、金融、计算机、政务、学术、游戏、文学、电商，以及自定义领域。
- 术语表锁定：指定原文和译法，保证专有名词前后一致。
- 按 Hy-MT2 官方方式调用：单条 user 消息、官方默认翻译模板、`temperature=0.7`、`top_p=0.6`；输出上限按 4096 token 上下文动态计算。
- 清晰的中文错误提示：401、403、404、429、5xx、网络失败、输出截断等。
- 自带本地中继；中继未运行时，第一次翻译会自动拉起，不需要额外启动 Pot 或手动开服务。

## 重要：系统代理导致内网请求 502

这台机器的 Windows 系统代理是 `127.0.0.1:9674`（mihomo/Tyty）。Pot 的插件走 Tauri/reqwest，**会读取系统代理**；`ProxyOverride` 里的 `10.*` 对 reqwest 没有生效，于是发往 `10.200.8.204:9090` 的请求被 mihomo 接管，约 60 秒后返回 502：

```text
[DEBUG][reqwest::connect] proxy(http://127.0.0.1:9674) intercepts 'http://10.200.8.204:9090/'
[INFO][webview::unknown] reject:[Hy-MT2] 请求失败：HTTP 502
```

而 `curl` 和 Node 不读 Windows 系统代理，所以 `diagnose.ps1` 能直接返回 200。这就是“诊断脚本正常、Pot 里 502”的原因。

### 方案 A：本地中继（插件自动管理，推荐）

插件包内已经带了 `relay/relay-hymt2.js` 和 `relay/start-relay.vbs`。每次翻译前插件会探测 `127.0.0.1:18766`：

- 中继已在运行：直接走中继；
- 中继没运行：通过 `wscript.exe` 自动拉起，最多等待约 1.2 秒，然后走中继；
- 中继无法启动：回退到直连（这种环境下仍会 502）。

所以 **重启 Pot 后直接翻译即可**，第一次可能多等约 1 秒，后续就是本机转发；中继进程即使比 Pot 晚启动也没关系，插件会等它起来再发请求。中继只监听本机，转发到 `http://10.200.8.204:9090`；插件用 WebView2 原生 `fetch` 访问 `127.0.0.1`，不会进入系统代理。

如果希望 **登录 Windows 就启动**（而不是等第一次翻译），可以额外运行一次：

```powershell
pwsh -ExecutionPolicy Bypass -File .\relay\install-relay.ps1
```

这个脚本是可选的：它把中继复制到 `%APPDATA%\pot-hymt2-relay`，写入 `HKCU\...\Run\PotHymt2Relay`，并立即启动。即使不运行，插件也会自动拉起包内的中继。

### 方案 B：临时关闭系统代理

关闭 Windows 设置里的“使用代理服务器”，重启 Pot，再翻译。验证完成后可以重新打开代理。这个方案不需要中继，但会影响其他需要代理的程序。

### 方案 C：代理绕过列表

把 `10.200.8.204` 和 `10.200.8.204:9090` 加入 Windows 代理绕过列表，然后重启 Pot。不同客户端对 `ProxyOverride` 的解析不一致，**不保证生效**；如果无效，回到方案 A。

## Hy-MT2 是否支持领域翻译？

支持，但需要区分“模型能力”和“专用开关”：

1. **模型本身做过领域翻译优化。** 官方在 DomainMTBench 上评测了金融、法律、政治、科技、医疗、教育六个领域；Hy-MT2-1.8B 相比上一代 Hy-MT1.5-1.8B，GEMBA 平均分从 88.82 提升到 91.08。官方模型卡也明确写到模型在 general、real-world business、domain-specific 和 instruction-following 翻译任务上表现良好。
2. **官方没有名为“domain”的独立参数或系统提示词。** Hy-MT2 没有默认 `system_prompt`，翻译指令需要完整写在 user 消息里。官方给出的模板包括：默认翻译、术语表（Terminology）、风格（Style）、个性化偏好（Personalization）、分隔符保留、结构化数据、背景信息。
3. **本插件的领域翻译怎么实现。** 使用官方的 **Personalization** 模板表达领域要求，并用 **Terminology** 模板锁定术语。例如选择“法律 / 合同”时，会在同一条 user 消息中加入“使用严谨规范的法律术语、保持权利义务精确性”等约束；再配合术语表，效果比单纯说“翻译成中文”更稳定。

因此，**1.8B 模型可以处理领域文本，但领域效果主要靠提示词约束和术语表来保证**。如果对某个垂直领域有大量固定译法，建议把术语表维护起来。

参考资料：

- [Hy-MT2 官方仓库（含 33 语种、7 类 Prompt 模板、推荐推理参数）](https://github.com/Tencent-Hunyuan/Hy-MT2/blob/main/README_CN.md)
- [Hy-MT2-1.8B-FP8 模型页](https://huggingface.co/tencent/Hy-MT2-1.8B-FP8)
- [Hy-MT2 论文（DomainMTBench 等领域评测）](https://arxiv.org/pdf/2605.22064)
- [Pot 翻译插件模板](https://github.com/pot-app/pot-app-translate-plugin-template)

## 安装

1. 下载 `plugin.cn.hymt2.translate.potext`。
2. 打开 Pot，进入 **设置 → 服务 → 翻译**。
3. 点击 **添加服务**，在插件列表中选择 **安装插件**，选中 `.potext` 文件。
4. 添加 **Hy-MT2 内网翻译** 服务，填写配置并保存。
5. 在翻译窗口中选择该服务。

也可以直接双击 `.potext` 文件安装。

## 配置说明

| 配置项 | 说明 |
| --- | --- |
| 请求地址 | **建议留空**：留空时插件先探测本地中继，中继不在才直连 `http://10.200.8.204:9090/v1`。如果填了地址，会**强制直连**、绕过中继。可填到 `/v1`，插件自动补 `/chat/completions`；不写协议时按 `http://` 处理。 |
| API Key | 公司内网模型的 Key。插件以 `Authorization: Bearer <key>` 发送。 |
| 模型名 | 默认 `Hy-MT2-1.8B-FP8`。如果网关使用其他模型 ID，改成网关实际暴露的名称。 |
| 翻译领域 | 默认“通用”。选择领域后会追加对应的专业翻译约束。 |
| 领域补充要求 | 可选。比如“称呼统一使用‘甲方’”“品牌名保留英文”。会作为一条任务加入提示词。 |
| 术语表 | 可选。格式：`原文=译文`，多条用中文或英文分号隔开。例如：`Cloud Native=云原生; Load Balancer=负载均衡`。也支持 `=>`、`->`、`→`。最多 80 条、2000 字符。 |

> Pot 的插件配置项只支持单行输入框和下拉框，所以术语表用分号分隔，不能直接换行。配置保存在 Pot 本地，插件代码中不包含任何 Key。

### 请求示例

插件实际发送到：

```text
POST http://10.200.8.204:9090/v1/chat/completions
Authorization: Bearer <你的 Key>
Content-Type: application/json
```

```json
{
  "model": "Hy-MT2-1.8B-FP8",
  "messages": [
    {
      "role": "user",
      "content": "将以下文本翻译为中文，注意只需要输出翻译后的结果，不要额外解释：\n\nHello"
    }
  ],
  "temperature": 0.7,
  "top_p": 0.6,
  "max_tokens": 2048,
  "stream": false
}
```

`max_tokens` 会在 192–2048 之间按提示词长度动态调整：这个内网部署的 `max_model_len` 是 4096，输入和输出必须同时放进 4096 个 token，固定写 4096 会直接报 400。

选择领域或填写术语表后，`messages[0].content` 会切换为官方的 Personalization + Terminology 组合模板，仍然是单条 user 消息。

## 限制

- 单次最多 **3000 字符**，超过会提示分段翻译；提示词（含领域和术语表）超过上下文时也会明确报错。
- 当前网关的 `max_model_len` 是 **4096 token**；插件会为输入预留空间，输出上限在 192–2048 之间动态计算。
- 请求超时 120 秒；超时或网络中断会给出明确提示。
- 非流式输出。Pot 当前插件协议可以流式回填，但本插件为保证兼容性使用一次性返回。
- 只支持 OpenAI 兼容的 `POST /v1/chat/completions`。如果公司网关使用其他路径或鉴权方式，需要在 `main.js` 中调整。
- 不支持 Azure 的 `api-key` 请求头或自定义额外请求头；当前按 Bearer Token 处理。
- 插件不包含语言检测逻辑，目标语言使用 Pot 传入的语言代码。
- Pot 语言列表中的瑞典语、挪威语（Bokmål / Nynorsk）未在插件中开放，因为 Hy-MT2 官方 33 语种列表不包含这三种语言。

## 无响应时怎么排查

Pot 3.x 在没有翻译结果时会把结果卡片折叠起来，而错误提示也放在这个卡片内部，所以插件报错时可能表现为“没有响应、也没有报错”。新版插件在出错时会主动展开卡片；如果仍看不到：

1. 点翻译卡片右侧的展开箭头（上下小箭头），红色错误文字会显示出来。
2. 打开 **设置 → 关于 → 查看日志**，查看最新日志中的 `reject` 或 `happened error`。
3. 在 PowerShell 中运行诊断脚本。它会提示输入 Key（不回显），直接请求一次 `/v1/chat/completions`，并打印 HTTP 状态、耗时和服务端返回：

```powershell
pwsh -ExecutionPolicy Bypass -File .\diagnose.ps1
```

如果脚本能返回正常 JSON，说明地址、Key、模型名都没问题，问题在 Pot 的插件调用或界面；如果脚本返回 401/404/400，按响应内容检查 Key、请求地址或模型名。

特别地：**诊断脚本 200、Pot 里 502**，几乎就是这个页面前面说的系统代理问题。检查中继是否在跑：

```powershell
curl.exe http://127.0.0.1:18766/health
```

期望返回 `{"ok":true,"target":"10.200.8.204:9090"}`。没有返回时，先在 Pot 里翻译一次（插件会自动拉起中继）；仍没有就运行 `relay\install-relay.ps1` 或双击 `%APPDATA%\pot-hymt2-relay\start-relay.vbs`。

## 本地开发与测试

`main.js` 是 Pot 直接 eval 的脚本，没有构建步骤。仓库内的 `tests/test.mjs` 使用 Node 内置断言模拟 Tauri HTTP 环境，覆盖 URL 拼接、默认提示词、领域提示词、术语表、错误处理和响应解析：

```bash
node tests/test.mjs
```

已在 Pot 3.0.7 + 本地中继上实测通过：调用 Pot 外部接口 `POST /translate` 翻译 `Hello`，日志返回：

```text
[plugin.cn.hymt2.translate@5io35z61gjj]resolve:你好
```

打包（zip 根目录必须包含 `info.json`、`main.js`、图标，以及 `relay/` 下的两个中继文件）：

```bash
python -c "import zipfile; z=zipfile.ZipFile('plugin.cn.hymt2.translate.potext','w',zipfile.ZIP_DEFLATED); [z.write(f) for f in ['info.json','main.js','hymt2.svg','relay/relay-hymt2.js','relay/start-relay.vbs']]; z.close()"
```

推送到 GitHub 后，仓库自带的 Actions 会自动生成 `.potext` 并上传到 artifact；打 tag 时会附加到 release。

## 目录结构

```text
.
├── info.json          # Pot 插件元数据、配置项、语言映射
├── main.js            # translate() 实现
├── hymt2.svg          # 插件图标
├── diagnose.ps1       # 不经过 Pot 的接口诊断脚本
├── relay/
│   ├── relay-hymt2.js     # 127.0.0.1:18766 -> 10.200.8.204:9090
│   ├── start-relay.vbs    # 隐藏窗口启动
│   └── install-relay.ps1  # 安装到 %APPDATA% 并设置登录自启
├── plugin.cn.hymt2.translate.potext  # 已打包插件
├── tests/test.mjs     # 本地模拟测试
├── README.md
└── LICENSE
```

## 仓库

- GitHub：<https://github.com/fanyuxuan-star/pot-app-translate-plugin-hymt2>
- 插件 ID：`plugin.cn.hymt2.translate`
- 插件包：仓库根目录的 `plugin.cn.hymt2.translate.potext`
- `info.json` 的 `homepage` 已指向该仓库。
