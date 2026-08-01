# PaperMind Connector 隐私政策

生效日期：2026-08-01

本政策适用于 PaperMind Connector Zotero 插件。插件把用户主动选择的文献发送到用户配置的 PaperMind 服务；它不是 Zotero 官方组件，Zotero 的隐私政策与本政策分别适用。

## 1. 插件在本地保存什么

插件在 Zotero 首选项中保存：PaperMind 服务地址、匿名设备 ID 和配置版本。旧版曾保存共享预览凭据；`0.3.0` 会清除这些旧字段。

专属链接中的设备 ID 相当于当前测试阶段的身份凭据。任何得到该链接的人都可能访问同一身份下的数据，请勿公开转发或粘贴到 GitHub Issue。

## 2. 什么时候会发送数据

只有用户主动选择 Zotero 条目并点击「用 PaperMind 精读」时，插件才会发送当前条目的：

- 题名、作者、期刊、日期、DOI、PMID、摘要等文献元数据；
- 当前条目可访问的最佳 PDF 附件；
- 匿名设备 ID，用于区分不同用户的数据。

插件不会自动上传整个 Zotero 文库，也不会在后台遍历其他条目。

## 3. PaperMind 服务可能保存什么

PaperMind 服务可能保存用户发送的文献元数据、PDF，以及后续在网页端产生的阅读记录、划词、卡片、笔记、对话、汇报板、自测记录和反馈。服务器基础设施还可能生成包含请求时间、接口路径、IP 地址和浏览器信息的标准访问日志。

这些数据用于提供精读、恢复阅读进度、生成内容、故障排查、限额控制和产品改进，不用于出售个人信息。

## 4. 第三方 AI 服务

当用户在 PaperMind 中使用精读、问答、卡片起草或自测等 AI 功能时，相关论文内容、选中文本、问题和必要上下文可能发送给服务运营者配置的第三方模型提供商。具体提供商可能随部署配置和故障回退策略变化。

请勿使用 PaperMind 处理患者身份信息、未公开敏感研究数据、机构机密，或用户无权上传和处理的文献。

## 5. 保存与删除

当前公开测试阶段尚未承诺统一的自动删除期限。数据通常保留到用户主动删除对应条目，或提出完整删除请求为止；备份中的副本可能在备份轮换完成前继续存在。

卸载插件或清除浏览器中的设备 ID 不会自动删除服务器数据。需要删除当前匿名身份下的全部数据时，请在 PaperMind「设置 → 用户反馈」中提交删除请求；反馈会自动关联当前设备身份，无需在正文中填写专属链接或设备 ID。

## 6. 用户可以做什么

- 不点击「用 PaperMind 精读」，插件就不会发送当前条目；
- 在 PaperMind 中删除单篇论文、PDF、笔记、卡片和对话等内容；
- 通过应用内反馈请求删除当前身份的全部服务器数据；
- 通过 Zotero 插件管理器停用或卸载 Connector。

## 7. 安全与当前限制

数据传输使用配置服务的 HTTP 或 HTTPS 地址；公开服务默认使用 HTTPS。匿名设备 ID 不是正式账号体系，当前也没有令牌撤销、密码恢复或多因素认证，因此本版本适合低敏感、小范围测试，不应被视为医疗数据系统。

安全漏洞请按照 [SECURITY.md](SECURITY.md) 私下报告，不要在公开 Issue 中披露可利用细节或身份信息。

## 8. 政策更新

本政策发生实质变化时，会在仓库提交记录和 Release 说明中标注。继续使用更新后的插件前，用户应查看最新版政策。

---

## English Summary

PaperMind Connector uploads only the Zotero item explicitly selected by the user, including its metadata, best available PDF attachment and an anonymous device identifier. It does not scan or upload the full Zotero library. Paper content and prompts may be sent to third-party AI providers configured by the PaperMind service. Server data is retained until item deletion or a verified deletion request; no uniform automatic retention period is promised during the public beta. Do not use the service for patient-identifiable, confidential or unauthorized content.
