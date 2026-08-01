# PaperMind Connector

PaperMind Connector 把 Zotero 中的论文元数据和本地 PDF 一键送入 PaperMind，继续完成结构化精读、证据卡片、苏格拉底自测与汇报整理。

> 当前为公开测试版，尚未提交 Zotero 社区插件市场。长期身份方案和多版本兼容测试仍在准备中。

## 当前能力

- 在 Zotero 文献右键菜单中提供「用 PaperMind 精读」
- 自动读取题名、作者、期刊、日期、DOI、PMID 与摘要
- 自动上传当前条目的最佳 PDF 附件
- 在默认浏览器打开对应的 PaperMind 精读页
- 保持 Zotero 与 PaperMind 使用同一匿名设备身份

## 安装与连接

1. 从 [GitHub Releases](https://github.com/lvyrana/papermind-zotero/releases/latest) 下载 `papermind-connector.xpi`。
2. Zotero →「工具」→「插件」→ 齿轮按钮 →「从文件安装插件」。
3. 打开 PaperMind 设置页，复制「我的专属链接」。
4. Zotero →「工具」→「PaperMind 连接设置…」，粘贴该链接。
5. 选中一篇文献，右键选择「用 PaperMind 精读」。

PaperMind 当前小范围试用不需要共享访问密码。`0.2.x` 升级到 `0.3.0` 时会自动保留专属链接，并清除 Zotero 首选项中已经失效的旧预览凭据。

## 数据边界

发送论文时，插件会把文献元数据和最佳 PDF 附件上传到用户配置的 PaperMind 服务。AI 解读过程中，论文内容和用户提问可能发送给 PaperMind 配置的第三方模型服务。请勿处理患者隐私、未发表敏感数据或无权上传的 PDF。

匿名设备 ID 用于区分书架、笔记、卡片和对话，但不是正式账号。专属链接包含该设备 ID，不应公开转发。

详细说明见[隐私政策](PRIVACY.md)。安全问题请按[安全政策](SECURITY.md)私下报告；一般问题与功能建议见[支持说明](SUPPORT.md)。

## 开发

```bash
node --test test-bootstrap.mjs
bash build.sh
unzip -t papermind-connector.xpi
```

每次 push 和 pull request 都会在 GitHub Actions 中重新运行测试、构建并检查 XPI。当前版本以 Zotero 9 为实际验证上限。

## 发布边界

- 正式 XPI 通过 GitHub Releases 分发；现有 `0.3.x` 安装仍从 PaperMind 主站更新清单检查新版本，后续版本再迁移更新地址。
- 当前匿名设备 ID 适合小范围试用，但不是面向公开市场的正式账号或可撤销令牌。
- 公开插件市场发布前，仍需完成正式身份、双语界面和版本兼容测试。

问题反馈可通过本仓库的 GitHub Issues 提交。请勿在 Issue 中粘贴专属链接、设备 ID、论文全文或患者信息。

## 许可证

PaperMind Connector 源码采用 [GNU Affero General Public License v3.0 only](LICENSE)（`AGPL-3.0-only`）。
许可证仅适用于本仓库中的 Zotero 插件源码，不代表 PaperMind Web 服务或后端代码采用相同许可证。

Copyright (C) 2026 lvyrana.
