# 研雀 · LitFinch 0.8.0（预发布）

阅读记录保存在自己的电脑，AI 使用自己的服务。公共免费额度停止提供。

- 设置新增「连接个人 AI」：OpenAI 兼容 API 地址、模型与个人密钥；密钥保存在本机 Login Manager，请求不经研雀服务器，不回退公共额度。
- 新增 Codex 入口：官方 CLI app-server、官方 ChatGPT 登录、本人订阅额度；使用独立本机目录、系统钥匙串和受限工具权限。
- 新增本篇阅读记录导出和恢复：包含卡片、对话、自测、带读、汇报与草稿。恢复前保留原文件副本；备份不含 PDF、API 密钥或登录凭据。
- 默认右键入口打开本地阅读台。旧资料仍可到网站查看、导出、下载和删除；原文件与账号标识保留。翻译只更换个人 AI 调用通道，后续翻译改进另做。

安装步骤见 [README](https://github.com/lvyrana/papermind-zotero#安装与连接)，数据流见 [隐私说明](https://github.com/lvyrana/papermind-zotero/blob/main/PRIVACY.md)。Codex 需先安装官方 CLI（协议检查版本 0.142.4）。API 的连接检查读取模型列表，不等于真实生成已验收。

本版进行逻辑回归、模拟宿主和官方 Codex 协议检查；尚未完成 Zotero 原生安装、真实个人 API 生成与 ChatGPT 登录验收，按预发布提供。旧版本的 macOS 验收不替代本版验收，Windows/Linux 兼容性也未据此确认。自动更新源不切换。

<details><summary>历史版本 0.7.1 说明</summary>

在 Zotero PDF 旁完成带读、翻译、追问、阅读卡片和单篇汇报，保留「用研雀精读」网页入口。

## 本次更新

- 支持新版网站的私有 PDF 直传，避免大文件经过云函数请求体；旧自建服务继续使用 multipart。
- 上传失败明确提示“文献信息已保存，PDF 未上传”，可以从网页补传。
- 沿用原插件身份、账号存储和本机阅读目录，不自动上传已有文库。
- 包含此前 0.7.0 阅读台、身份登录、连接安全与本地卡片功能。

## 下载和安装

下载附件 **papermind-connector.xpi**，在 Zotero 的「工具 → 插件」中选择「从文件安装插件」；不要下载 Source code。打开 PDF，点击「研雀」并按提示登录。安装和截图见 [README](https://github.com/lvyrana/papermind-zotero#安装与连接)。升级前保存笔记并备份本机 `papermind-reading/`。

## 验证与限制

- 已验收：macOS / Zotero 9.0.6 的真实登录、进程重启恢复、2.94 MB PDF 上传、网页读回、退出撤销及阅读文件保留。
- 6 MiB 大文件另在 Node 模拟宿主完成真实 HTTP 上传和哈希读回；Windows、Linux、Zotero 7/8 与其他 9.x 尚未原生验收。
- 插件 83 项回归及 XPI 内容检查通过；安装包附 AGPL-3.0-only 与第三方声明。
- GitHub 稳定包供手动安装。主站自动更新清单仍为 0.3.0，本次不自动升级旧用户。

Zotero 授权仅用于账号身份。原生阅读台点击 AI 时发送相关文字；网页导入会上传所选论文的 PDF。AI 使用研雀服务的准入和额度或自建服务配置，源码公开不附赠无限模型额度。插件记录不自动同步到网页，退出不删除本机记录。详见 [隐私说明](https://github.com/lvyrana/papermind-zotero/blob/main/PRIVACY.md)。

</details>
