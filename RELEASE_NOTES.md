# 研雀 · LitFinch 0.8.0：个人 AI 与本地备份

阅读记录保存在自己的电脑，AI 使用自己的服务。公共免费额度停止提供。

- **连接个人 AI**：填写 OpenAI 兼容 API 地址、模型与个人密钥，直接连接所选服务；密钥保存在本机 Login Manager。
- **使用 ChatGPT 订阅**：通过官方 Codex CLI 登录本人账号，凭据由系统钥匙串管理，研雀使用独立的本机目录。
- **导出与恢复阅读记录**：本篇备份包含卡片、对话、自测、带读、汇报和已保存草稿，恢复前自动保留当前文件副本。
- **本地阅读入口**：从 Zotero 右键菜单直接打开阅读台；旧网站资料保留原账号访问与导出入口。现有翻译操作接入个人 AI。

这是供主动下载安装的先行体验版，GitHub 标记为 **Pre-release**。下载附件 **papermind-connector.xpi**，在 Zotero「工具 → 插件」中选择「从文件安装插件」。

[安装与连接](https://github.com/lvyrana/papermind-zotero#安装与连接) · [隐私说明](https://github.com/lvyrana/papermind-zotero/blob/main/PRIVACY.md)

### 验证记录

插件 90 项测试、阅读台与 AI 设置模拟浏览器流程、官方 Codex 0.142.4 初始化与临时会话协议检查通过。GitHub CI 通过，安装包 13 个文件与发布源码一致。

下一轮验收：Zotero 实机安装、个人 API 生成、ChatGPT 登录与阅读生成。

[历史版本](https://github.com/lvyrana/papermind-zotero/releases)
