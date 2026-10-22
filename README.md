# 研雀 · LitFinch for Zotero

在 Zotero 的 PDF 旁完成带读、翻译和追问，把阅读所得整理成带原文出处的卡片与单篇汇报。

[下载 0.7.0 预发布包](https://github.com/lvyrana/papermind-zotero/releases/tag/preview-0.7.0) · [免登录试读网页版](https://papermindapp.com/demo) · [网站源码](https://github.com/lvyrana/papermind-source) · [问题反馈](https://github.com/lvyrana/papermind-zotero/issues)

## 阅读台预览

从当前论文进入带读，沿页码回到原文核对，再存为卡片或送入汇报。

<img src="docs/screenshots/reading-card-20261022.png" alt="研雀阅读台：带页码的带读结果、阅读卡片与汇报入口" width="420">

截图为当前阅读台组件，使用合成论文与预设回答，Zotero 宿主由测试模拟。[截图来源](docs/screenshots/README.md)。

## 能做什么

- **带着原文读**：阅读路线、摘要和当前页带读；跟随 Zotero 的附件、活动分屏、页码与选段。
- **从选段继续**：划词后精读、翻译、追问或存为卡片；保留 PDF 页码入口。
- **整理阅读成果**：编辑卡片，按背景、方法、发现、局限与启发组织汇报；卡片和汇报可保存为 Zotero 子笔记。
- **检查理解**：围绕当前论文自测，核对回答后转为卡片或继续追问。
- **保留本机记录**：带读、卡片、对话、自测和汇报按论文保存；重开后恢复。网站与插件记录分别保存。

## 安装 0.7.0 预发布版

本版面向小范围试用。已在 **macOS / Zotero 9.0.6** 验证真实登录、完整退出并重开 Zotero 后恢复登录、插件独立退出；Windows、Linux 和其他 Zotero 版本尚未完成原生验收。

1. 下载 [0.7.0 的 `papermind-connector.xpi`](https://github.com/lvyrana/papermind-zotero/releases/download/preview-0.7.0/papermind-connector.xpi)。
2. Zotero →「工具」→「插件」→ 齿轮 →「从文件安装插件」，选择 XPI。安装后核对版本 `0.7.0` 和名称「研雀 · LitFinch」。
3. 打开一篇带 PDF 的文献，点击顶部「研雀阅读台」。
4. 阅读台点「登录」，在浏览器核对连接码，通过 Zotero 官方页面确认，再返回插件。Zotero Desktop 的同步登录与研雀登录分别进行。
5. 有摘要先点「读摘要」；缺摘要可从 PDF 生成「阅读路线」。划词精读后存成卡片，用页码入口回到原文。

沿用原插件身份、连接配置和阅读目录。更新前保存正在编辑的内容并备份 Zotero 配置目录；自动更新仍保持旧正式版 **0.3.0**，本版需手动安装。旧版只提供向网页导入的路径，下载 `releases/latest` 不会得到本预发布版。

手工阅读和卡片免登录。AI 服务的可用性由所连接服务的配置与邀请决定，登录成功不自动获得模型额度。自部署服务须使用 HTTPS；本机开发允许 localhost / loopback HTTP。连接、安装和无敏感信息的反馈模板见 [SUPPORT.md](SUPPORT.md)。

## 数据如何处理

原生阅读台通过 Zotero 的 PDF.js 读取本地文字；点击 AI 操作时发送相关文字和问题，不上传整个 PDF。文献右键「用研雀精读」是另一个入口，会上传元数据和最佳 PDF 到网页服务。

登录只确认 Zotero 身份，不申请云端文库权限；凭据保存在 Zotero/Firefox Login Manager。退出撤销当前插件会话，网页可继续登录。本机阅读文件在配置目录 `papermind-reading/`，退出不删除；写入使用临时文件替换，读取失败不覆盖旧文件。

论文内容与问题可能发送给配置的模型服务。请勿上传患者隐私、未发表敏感数据或无权提供的论文；专属链接含访问标识，不能公开转发。详见 [隐私说明](PRIVACY.md)与[安全报告渠道](SECURITY.md)。

## 开发与验证

需要 Node.js 22、zip 和 unzip。构建不安装运行时 npm 依赖。

```bash
node --test test-*.mjs
bash build.sh
node scripts/check-package.mjs papermind-connector.xpi
unzip -t papermind-connector.xpi
```

72 项测试覆盖登录与撤销、连接切换、HTTPS、选段归属、阅读存储、品牌兼容和打包边界。构建检查 XPI 的 11 个文件及源码一致性。GitHub CI 在 push 和 pull request 时重跑测试、构建与归档检查。

可选浏览器回归：`node scripts/check-workspace-browser.mjs` 和 `node scripts/check-sidebar-browser.mjs`。需要 Playwright；可用 `PAPERMIND_PLAYWRIGHT_MODULE` 指定模块，`PAPERMIND_CHROMIUM_EXECUTABLE` 指定浏览器。测试使用合成论文、模拟接口与独立记录，不调用真实模型或写入真实文库。

PDF 文字提取最多检查 200 页或累计 80 万字符；全文背景包约 2.4 万字符，另带摘要、当前页、选段、提问和有限对话。扫描页无 OCR 时提示补充文字。跨网页同步、跨论文汇报和图表视觉理解不在本版内。历史变更与分阶段验收见 [CHANGELOG.md](CHANGELOG.md)。

## 许可

原创代码采用 [AGPL-3.0-only](LICENSE)，Copyright (C) 2026 lvyrana。安装包不捆绑第三方运行库、字体或平台二进制；宿主组件、开发工具与远程服务的边界见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

原名 PaperMind Connector；包名、插件 ID、存储键与更新地址保留原标识。未引入 PaperChat 代码或服务。
