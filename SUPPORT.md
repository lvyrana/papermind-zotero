# Support

## 新版试用常见问题

本节对应 0.7.0 本地候选，真实授权和原生安装仍待验收。旧公开包 0.3.0 只有网页导入入口；安装与连接按 [README](README.md#安装与连接)区分版本。

| 问题 | 处理方式 |
|---|---|
| 没有「研雀」入口 | 先看插件版本，再确认已打开 PDF；旧公开包仍显示 PaperMind，不能按新版阅读台寻找按钮 |
| 显示登录尚未启用 | 向维护者反馈版本和提示；这是配套服务配置待完成，不需要提交 Zotero 密码或自行创建文库 Key |
| Zotero 已同步登录，研雀仍要求登录 | 两者会话分别管理；按阅读台的登录入口完成身份确认 |
| 登录后仍无 AI 权限 | 邀请与额度独立生效，记录具体提示，由维护者核对 |
| 当前页没有可读取文字 | 改试摘要或有文字层的页面；当前原生阅读台不提供扫描页 OCR |
| 插件卡片未出现在网页 | 当前未实现自动同步；返回原服务、原账号和原论文查找，不删除本地阅读目录 |
| 回答能显示但解释不准确 | 单列为内容问题，记录页码及错误类型，区分数字错误、关系解释和结论过强 |

一条消息即可反馈：入口与版本、最后一个操作、期望结果、实际提示、系统及 Zotero 版本、大致时间。截图裁剪到必要区域；不要为复现问题反复切换账号或公开完整文献。

## Bug reports

Use GitHub Issues for reproducible plugin bugs and feature suggestions. Include:

- LitFinch for Zotero version;
- Zotero version;
- operating system;
- whether the failure happens during connection, metadata upload, PDF upload or browser opening;
- concise reproduction steps and the exact non-sensitive error message.

Do not attach copyrighted PDFs or include personal links, device IDs, API keys, patient information or unpublished sensitive data.

## Data deletion

Do not post a device ID in GitHub Issues. Request server-data deletion through「设置 → 用户反馈」while using the original identity or signed-in account. Describe the requested scope without pasting credentials or personal links. A request is not confirmation that deletion has completed.

Server records, account ownership/sessions, local `papermind-reading/` files, exported Zotero notes and backup copies require separate handling. Logging out or uninstalling the plugin does not delete all of them. The older anonymous-UUID deletion script does not cover the account database or local plugin files; it must not be reported as complete account deletion. Follow [PRIVACY.md](PRIVACY.md#5-保存与删除) and obtain a scope-specific completion report from the service maintainer.

## Security reports

Potential vulnerabilities must be reported privately through the repository's **Report a vulnerability** form as described in [SECURITY.md](SECURITY.md).
