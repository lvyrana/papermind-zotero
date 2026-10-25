# 研雀 · LitFinch for Zotero

在 Zotero PDF 旁完成带读、追问、阅读卡片、自测和单篇汇报。阅读记录保存在自己的电脑，AI 使用个人 API 或通过官方 Codex 登录自己的 ChatGPT 订阅。

当前版本 **0.8.0** 为先行体验版，GitHub 标记为 **Pre-release**，通过下载安装包升级。

[下载安装包](https://github.com/lvyrana/papermind-zotero/releases/download/preview-0.8.0/papermind-connector.xpi) · [版本说明](RELEASE_NOTES.md) · [隐私说明](PRIVACY.md) · [网站与样例](https://papermindapp.com/welcome)

## 阅读台预览

从当前论文进入带读，保留原文页码，再整理成卡片和汇报材料。

<img src="docs/screenshots/reading-card-20261022.png" alt="研雀阅读台：带页码的带读结果、阅读卡片与汇报入口" width="420">

截图使用合成论文和演示回答，展示阅读台组件。截图来源见[说明](docs/screenshots/README.md)。

## 安装与连接

1. 下载上方的 `papermind-connector.xpi`。升级前保存笔记，并备份 Zotero 配置目录中的 `papermind-reading/`。
2. Zotero →「工具」→「插件」→ 齿轮按钮 →「从文件安装插件」，选择 XPI。
3. 打开一篇带 PDF 的文献，点击顶部「研雀」，进入「连接 AI」。
4. 配置自己的 AI，然后从「读摘要」或「阅读路线」开始。

**个人 API**：填写 OpenAI 兼容接口地址（包含服务要求的 `/v1` 等路径）、模型名和密钥，保存后检查连接。密钥保存在本机 Login Manager；连接检查读取模型列表，阅读操作使用所填模型。

**Codex / ChatGPT 订阅**：先安装[官方 Codex CLI](https://learn.chatgpt.com/docs/cli)，选择 Codex，点击「使用 ChatGPT 登录」，在 OpenAI 官方网页完成登录后回到研雀检查连接。模型名留空时采用账号默认值，额度按本人订阅计算。官方协议检查使用 CLI 0.142.4。

**本机模型**：填写 localhost、127.0.0.1 或 [::1] 的 OpenAI 兼容 HTTP 地址；远程服务使用 HTTPS。

## 阅读与整理

- 阅读路线、摘要和当前页带读，回答带原文页码。
- 划词后精读、翻译、带入追问或存为卡片；选段与回答可回到 PDF 核对。
- 从原文、AI 回答和个人笔记创建卡片，再按背景、方法、发现、局限与启发整理汇报。
- 自测围绕当前论文出题、核对回答，结果可转为卡片。
- 卡片和汇报可保存为 Zotero 子笔记，按个人 Zotero 设置同步。
- 本地 PDF 阅读、手工卡片和汇报整理可直接使用；需要生成内容时连接个人 AI。

长文根据当前页、选段和问题选取相关正文。点击 AI 操作后，所需文字直接发送给所选服务；PDF 文件留在 Zotero。

## 个人记录与备份

卡片、带读、对话、自测、汇报和已保存草稿位于 Zotero 配置目录的 `papermind-reading/`。升级沿用原插件身份和阅读文件。

在阅读台设置中选择「导出本篇完整阅读记录」，保存 JSON；换电脑后打开同一 Zotero 条目，再选择「恢复本篇阅读记录」。恢复先核对条目 key，并保留当前文件副本。备份仅包含阅读记录；PDF、文库和登录凭据分别由 Zotero、个人备份与系统凭据存储管理。

旧网站资料可用原账号查看、导出、下载和删除。云端 JSON 用作个人档案，插件恢复入口使用本篇导出的备份文件。已有自建研雀服务保留主动上传入口。

## 开发与支持

```bash
node --test test-*.mjs
node scripts/check-workspace-browser.mjs
node scripts/check-ai-browser.mjs
bash build.sh
node scripts/check-package.mjs papermind-connector.xpi
```

浏览器回归使用 Playwright，可通过 `PAPERMIND_CHROMIUM_EXECUTABLE` 指定浏览器。GitHub Actions 执行测试、构建和安装包检查。

[使用支持](SUPPORT.md) · [安全反馈](SECURITY.md) · [历史变更](CHANGELOG.md) · [第三方声明](THIRD_PARTY_NOTICES.md)

许可：**AGPL-3.0-only**，见 [LICENSE](LICENSE)。
