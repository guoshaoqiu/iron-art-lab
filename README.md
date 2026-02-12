# 铁板爻画 (IronArtLab)

一个中文 Web MVP：用户输入本人及家庭相关信息后，调用 DeepSeek 大模型生成娱乐性命理分析。

## 免责声明

本项目输出仅供娱乐与参考，不构成医学、法律、金融、心理或人生重大决策建议。

## 隐私与数据处理

- 默认不落库存储用户输入。
- 用户输入只在本次请求中传递给后端，再由后端转发到 DeepSeek API。
- 请勿输入身份证号、银行卡号、联系方式等与本功能无关的敏感个人信息。
- 在上线前请根据你所在地区法律要求补充隐私政策与用户同意机制。

## 功能

- 中文信息录入表单（本人/父母八字、兄弟姐妹、婚姻状况、补充说明）
- 后端 API 代理（避免在前端泄露 API Key）
- DeepSeek 模型调用（模型名可配置）
- 结果展示 + 免责声明提示

<img width="2560" height="1440" alt="image" src="https://github.com/user-attachments/assets/63c2e032-fa04-4c35-807b-3af5f2780377" />


## 技术栈

- Node.js (>= 18.17)
- 原生 `http` + 原生前端（零第三方依赖）

## 快速开始

1. 复制环境变量模板

```bash
cp .env.example .env
```

2. 编辑 `.env`，至少配置：

- `DEEPSEEK_API_KEY`
- 可选：`MODEL_NAME`、`DEEPSEEK_BASE_URL`、`PORT`

3. 启动项目

```bash
npm run start
```

4. 打开浏览器

- `http://localhost:3000`

## 环境变量

- `DEEPSEEK_API_KEY`：DeepSeek API Key（必填）
- `MODEL_NAME`：模型名，默认 `deepseek-chat`
- `DEEPSEEK_BASE_URL`：API 地址，默认 `https://api.deepseek.com`
- `PORT`：服务端口，默认 `3000`

## API

### `POST /api/analyze`

请求 JSON：

```json
{
  "nickname": "张三",
  "selfBazi": "示例八字",
  "fatherBazi": "示例八字",
  "motherBazi": "示例八字",
  "siblings": "一兄一妹",
  "maritalStatus": "未婚",
  "note": "可选"
}
```

返回 JSON：

```json
{
  "disclaimer": "以下内容仅供娱乐与参考，不构成医学、法律、金融、心理或人生重大决策建议。",
  "model": "deepseek-chat",
  "analysis": "模型返回的文本"
}
```

## 开源建议

- License: MIT
- 建议打开 GitHub Issues/Discussions 收集反馈
- 发布前建议补充：
  - 更严格输入脱敏
  - 访问频控与滥用防护
  - 错误日志脱敏策略

## GitHub 发布

```bash
git init
git add .
git commit -m "init: 铁板爻画 MVP"
git branch -M main
git remote add origin <你的仓库URL>
git push -u origin main
```
