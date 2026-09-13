---
title: Markdown 写作示例
date: 2026-09-11 20:00:00
categories:
  - 写作
tags:
  - Markdown
---

这篇用来展示常见的 Markdown 写法在站点上的渲染效果，写文章时可以直接参考。

<!-- more -->

## 标题与段落

正文直接写即可，段落之间空一行。**加粗**、*斜体*、~~删除线~~、`行内代码`。

## 列表

无序列表：

- 第一项
- 第二项
  - 嵌套项

有序列表：

1. 第一步
2. 第二步

## 引用与链接

> 好的文档应该让读者一次读懂，而不是读第二遍。

链接写法：[Hexo 官方文档](https://hexo.io/zh-cn/docs/)。

## 代码块

```javascript
const posts = ['写作', '阅读', '思考'];

posts.forEach((item, index) => {
  console.log(`${index + 1}. ${item}`);
});
```

## 表格

| 语法 | 效果 |
| --- | --- |
| `**文字**` | **加粗** |
| `*文字*` | *斜体* |
| `` `代码` `` | `代码` |

## 图片

把图片放进 `source/img/`，然后这样引用：

```markdown
![图片说明](/img/example.png)
```
