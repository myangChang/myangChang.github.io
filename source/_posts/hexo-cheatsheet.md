---
title: Hexo 常用命令速查
date: 2026-09-12 21:30:00
categories:
  - 工具
tags:
  - Hexo
---

把 Hexo 日常会用到的命令整理成一张表，方便随时查阅。

<!-- more -->

## 命令速查

| 命令 | 作用 |
| --- | --- |
| `npm run new -- "标题"` | 新建文章（生成到 `source/_posts/`） |
| `npm run new -- "标题" --draft` | 新建草稿（生成到 `source/_drafts/`） |
| `npm run dev` | 本地预览，包含草稿，默认 <http://localhost:4000> |
| `npm run build` | 生成静态站点到 `docs/` |
| `npm run clean` | 清除缓存和已生成的文件 |
| `npm run publish` | 重新生成并推送到 GitHub |

## 文章头信息

每篇文章顶部的 `---` 之间是 Front-matter，常用字段：

```yaml
---
title: 文章标题
date: 2026-09-13 10:00:00
categories:
  - 分类名
tags:
  - 标签一
  - 标签二
---
```

## 常见问题

**改了配置没生效？** 先 `npm run clean` 再重新生成，Hexo 会缓存渲染结果。

**文章没出现在首页？** 检查 `date` 是否写成了未来的时间，默认情况下未来文章不会生成。

**想调整首页每页文章数？** 修改 `_config.yml` 里的 `index_generator.per_page`。
