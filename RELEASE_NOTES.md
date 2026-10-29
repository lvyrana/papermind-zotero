# 研雀 · LitFinch 0.8.5：模型自由选择与简短摘要

本版修复 Zotero 10.0 因兼容声明而停用插件的问题，并改进个人 AI 阅读入口。

- 在“连接 AI”中获取当前服务的可用模型，分别选择精读与翻译模型，也可手动填写。翻译留空时沿用精读模型。
- “读摘要”只使用题名与条目摘要，默认约 200—250 字、最多三段，解释研究方法和核心发现。
- 密钥输入含中文、内部空白或换行时，在保存前提示修正；原有凭据保留。
- 升级沿用原插件身份和本机阅读记录。

这是先行体验版。下载附件 `papermind-connector.xpi`，在 Zotero“工具 → 插件 → 从文件安装插件”中安装。升级前备份 Zotero 配置目录中的 `papermind-reading/`。

## 已验证

macOS / Zotero 10.0.6 原生安装及个人 API 生成通过；模型列表可读取、精读与翻译可分别保存，同篇摘要实测238字、三段，划词翻译调用返回中文。完整工程检查与独立审计通过，安装包13个成员与源码核对一致。

本轮实测覆盖个人 API；Codex 路由通过工程回归。摘要实际篇幅和措辞随所选模型与论文变化，Windows/Linux 原生使用仍待验证。

[安装与连接](https://github.com/lvyrana/papermind-zotero#安装与连接) · [隐私说明](https://github.com/lvyrana/papermind-zotero/blob/main/PRIVACY.md) · [历史版本](https://github.com/lvyrana/papermind-zotero/releases)
