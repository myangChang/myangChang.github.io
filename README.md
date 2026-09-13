# myangChang 的技术博客

个人技术博客，基于 [Hexo](https://hexo.io/zh-cn/) 生成，使用 [Fluid](https://hexo.fluid-dev.com/) 主题，
由 GitHub Pages 托管，发布目录为 `docs/`。

## 环境要求

- Node.js ≥ 20（当前使用 v24 LTS）
- Git

## 本地使用

```bash
npm install      # 首次运行，安装依赖

npm run dev      # 本地预览：http://localhost:4000
npm run build    # 生成静态站点到 docs/
npm run clean    # 清理缓存与生成结果
npm run publish  # 生成站点并提交推送到 GitHub
```

## 写一篇新文章

```bash
npm run new -- "文章标题"
```

然后编辑 `source/_posts/文章标题.md`。文章顶部的 front-matter 用来设置标题、日期、分类和标签：

```yaml
---
title: 文章标题
date: 2026-09-13 10:00:00
categories:
  - 分类名
tags:
  - 标签名
---
```

暂时不想发布的文章放到 `source/_drafts/`，`npm run dev` 能预览，正式生成时会被忽略。

## 目录结构

```text
├── _config.yml          # 站点配置（标题、作者、URL、分页等）
├── _config.fluid.yml    # 主题配置（配色、菜单、banner、关于页等）
├── scaffolds/           # 新建文章 / 页面的模板
├── source/
│   ├── _posts/          # 文章
│   ├── _drafts/         # 草稿
│   ├── about/           # 关于页
│   ├── css/custom.css   # 自定义样式
│   └── img/             # 图片、头像、banner
└── docs/                # 生成结果，GitHub Pages 发布目录（不要手动修改）
```

## 部署到 GitHub Pages

仓库配置为发布 `master` 分支的 `/docs` 目录：

1. 打开仓库 **Settings → Pages**；
2. **Source** 选择 `Deploy from a branch`；
3. **Branch** 选择 `master`，目录选择 `/docs`，保存；
4. 本地执行 `npm run publish`（或手动 `git push`），稍等片刻即可访问 <https://myangchang.github.io>。

> `docs/` 是 Hexo 生成的静态文件，每次发布都会重新生成，不需要手动编辑。

## 常用定制

| 想改什么 | 改哪里 |
| --- | --- |
| 站点标题、副标题、作者、域名 | `_config.yml` |
| 配色、banner、菜单、关于页信息 | `_config.fluid.yml` |
| 头像 | 替换 `source/img/avatar.png` |
| 首屏背景图 | 替换 `source/img/banner.svg` |
| 自定义样式 | `source/css/custom.css` |
| 关于页正文 | `source/about/index.md` |
