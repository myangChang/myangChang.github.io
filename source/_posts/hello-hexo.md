---
title: 用 Hexo + Fluid 重建本站
date: 2026-09-13 10:00:00
categories:
  - 博客
tags:
  - Hexo
  - Fluid
  - GitHub Pages
---

本站从手写的 HTML 页面迁移到了 **Hexo**，主题选用 **Fluid**。这篇是第一篇文章，用来记录建站过程，也顺便当作写作模板。

<!-- more -->

## 为什么是 Hexo + Fluid

选型时主要考虑三点：

1. **纯静态生成** —— 生成结果是普通 HTML/CSS/JS，天然适合 GitHub Pages，不需要服务器和数据库。
2. **写作即 Markdown** —— 新文章就是一个 `.md` 文件，写完提交，站点自动更新。
3. **主题成熟** —— [Fluid](https://hexo.fluid-dev.com/) 是 Hexo 社区最流行的主题之一，界面简洁大气，自带暗色模式、本地搜索、响应式布局，中文文档也很完善。

## 目录结构

```text
.
├── _config.yml          # 站点配置（标题、作者、插件等）
├── _config.fluid.yml    # 主题配置（外观、菜单、社交链接等）
├── source/
│   ├── _posts/          # 文章，写作都在这里
│   ├── _drafts/         # 草稿，不会被发布
│   ├── about/           # 关于页
│   ├── categories/      # 分类页
│   ├── tags/            # 标签页
│   ├── css/             # 自定义样式
│   └── img/             # 图片资源
├── scaffolds/           # 新建文章/页面的模板
└── docs/                # 生成的静态站点（GitHub Pages 发布目录）
```

## 日常写作流程

```bash
# 新建一篇文章
npm run new -- "我的第一篇文章"

# 本地预览，浏览器打开 http://localhost:4000
npm run dev

# 生成静态站点到 docs/
npm run build

# 生成并推送到 GitHub，稍等片刻线上就更新了
npm run publish
```

## 写作之外的小事

- 草稿放在 `source/_drafts/`，`npm run dev` 可以看到，正式生成时会忽略；
- 图片统一放 `source/img/`，文章里用 `/img/xxx.png` 引用；
- 想在首页显示摘要，在正文里加一行 `<!-- more -->`。

就写到这里，接下来可以开始记录技术笔记了。
