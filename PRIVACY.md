# 研雀 · LitFinch 隐私说明

适用版本：0.8.0 · 更新日期：2026-10-25

## 本地保存

PDF 由 Zotero 管理。卡片、带读、对话、自测、汇报和已保存草稿位于 Zotero 配置目录的 `papermind-reading/`，以本机账户可读取的 JSON 文件保存，由操作系统账户保护。阅读记录通过插件的导出与恢复功能备份；保存到 Zotero 子笔记的内容按个人 Zotero 同步与群组设置处理。

连接方式、API 地址和模型名保存在首选项；API 密钥保存在本机 Zotero / Firefox Login Manager。Codex 登录凭据由官方客户端存入系统钥匙串，使用插件独立的 `papermind-codex/` 目录。

## AI 请求

点击带读、追问、自测或翻译等 AI 操作时，当前任务需要的题名、摘要、页码、选段、正文节选及相关对话或卡片直接发送到个人选择的 AI 服务。PDF 文件留在 Zotero。AI 提供商按自己的数据政策处理接收的文字；研雀维护者的服务器退出这条调用链。

「检查连接」读取服务的模型列表。个人 API 使用 HTTPS；本机模型可使用 loopback HTTP。携带凭据的请求要求服务直接响应，连接错误在阅读台显示。

Codex 使用官方 CLI app-server 和官方 ChatGPT 登录，额度属于本人订阅。阅读任务采用临时会话与限定权限，文件、命令和联网工具保持关闭。官方客户端的运行诊断保存在个人应用数据目录。

## 备份、恢复与清理

「导出本篇完整阅读记录」生成仅包含阅读记录的 JSON。PDF、API 密钥与登录凭据分别由 Zotero、Login Manager 和系统钥匙串管理。恢复时核对 Zotero 条目 key，先保留当前文件副本，再写入记录。换电脑前保存备份，并单独处理 Zotero 文库与 PDF。

卸载后，本地阅读文件继续保留。清理记录时先关闭 Zotero，再将 `papermind-reading/` 移至废纸篓；密钥通过「移除本机密钥」清理，Codex 登录通过「退出 Codex」结束。

## 旧网站资料与自建服务

旧网站资料保留在原云端空间，可用原账号查看、导出、下载和删除。云端 JSON 用作个人档案，PDF 与图表分别下载；插件恢复入口使用本篇导出的备份文件。历史备份按原维护流程保留和轮换。访问网站会产生时间、IP 和接口路径等基础设施日志。

默认公共站的插件入口打开本地阅读台。连接自建研雀服务的使用者主动导入时，所选文献元数据与 PDF 发送到自己的服务。

[安全反馈](SECURITY.md) · [版本说明](RELEASE_NOTES.md) · [0.7.1 历史政策](https://github.com/lvyrana/papermind-zotero/blob/v0.7.1/PRIVACY.md)

**English summary:** Reading records stay in the user's Zotero profile. Personal API requests go directly to the selected provider; Codex uses its official app-server and the user's ChatGPT subscription. Reading backups contain reading records only. Legacy website records remain accessible through the original account. Self-hosted connections retain their explicit upload flow.
