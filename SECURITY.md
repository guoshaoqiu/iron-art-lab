# Security Policy

## Supported Versions

当前仅维护 `main` 分支。

## Reporting a Vulnerability

如果你发现安全问题（如密钥泄露、越权访问、敏感信息暴露），请不要公开提交 Issue。

请通过私信或邮件联系维护者，附上：

- 漏洞描述
- 复现步骤
- 影响范围
- 修复建议（可选）

维护者会尽快确认并安排修复。

## Security Notes

- 不要将真实 `.env` 提交到仓库。
- 生产环境建议启用 HTTPS、WAF、速率限制。
- 日志中避免记录完整用户敏感输入与 Token。
