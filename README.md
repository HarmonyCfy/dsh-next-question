# dsh-next-question

在 DSH（DeepSeek Harness）里，让主模型在回答结束时顺手预测你的下一句话，以灰色 ghost text 显示在输入框；按 **Tab** 采纳，直接输入则忽略。

**零额外模型请求**：预测随主回答一起生成，不调用第二个模型，也没有额外往返延迟。

> Predict the user's next message inside the main model's own reply and show it as ghost text in the composer. Zero extra model calls, zero extra round-trips.

## 效果

- 回答结束后，输入框出现一行灰色预测，例如「帮我把这个函数改成异步」
- 按 `Tab` 采纳进草稿，光标落在末尾，可以继续编辑或直接发送
- 直接键入任意字符即忽略预测
- 斜杠 / @ 菜单打开时，`Tab` 仍归菜单使用
- 会话运行中、已有草稿或附件时不显示

## 原理

1. **Host 侧**在每轮请求的运行时上下文里注入一小段格式要求（紧邻最新用户消息，而不是放在系统提示里，长会话更稳）。

2. 主模型在回答最后输出一行隐藏标记：

   ```text
   [//]: # "nextq: 用户下一句最可能发送的话"
   ```

   这是 CommonMark 的 link reference definition，DSH 的 Markdown 渲染器把它解析成 `definition` 节点后直接丢弃，所以正文里看不到。用引号形式的 title 而不是括号形式，预测内容里出现括号（如 `fix(test)`）也不会破坏语法。

3. **浏览器侧**订阅当前会话的事件流，从最新的 `assistant/message` 原文里提取标记，按编辑器字体和文本起点绝对定位，叠加成 ghost text。

成本：运行时上下文约 80 tokens，模型输出约 10 到 20 tokens 的隐藏标记。**没有第二个模型请求。**

## 安装

要求 DSH `>= 0.2.1-rc.2`、Node `^22.19 || >=24`。包目前只发布在 GitHub，未发布到 npm。

### 通过插件管理器（推荐）

```bash
dsh plugin --profile <profile> add github:HarmonyCfy/dsh-next-question
```

`<profile>` 换成你的 profile 名（Desktop 用 `desktop`，Web 用 `web`）。pnpm 会把 `github:` 简写解析成 commit 锁定的 tarball 直接安装，插件管理器会自动把 `dsh-next-question` 写进 profile 的 `dsh.profile.bundles`。然后完全退出 DSH 再重新打开。

> 如果安装时 pnpm 提示构建脚本被阻止（allowBuilds），按提示把打印出来的 key 加进 profile 的 `pnpm-workspace.yaml` 后重跑；本包无构建脚本，正常不会遇到。

### 手动安装

在 profile 目录（例如 `~/.dsh/profiles/web`）的 `package.json` 里：

```json
{
  "dependencies": {
    "dsh-next-question": "github:HarmonyCfy/dsh-next-question"
  },
  "dsh": {
    "profile": {
      "bundles": ["...", "dsh-next-question"]
    }
  }
}
```

执行 `pnpm install`，然后完全退出 DSH 再打开。包自带的 `cordis.patch.yml` 会插入 `next-question` 行。

> 建议固定到具体 commit（`github:HarmonyCfy/dsh-next-question#<commit>`），避免后续推送改变行为。

## 使用

在任意会话里正常提问。回答结束后看输入框底部：

- 有灰色预测：`Tab` 采纳，或直接输入忽略
- 没有预测：本轮模型判断没有明确后续，或模型漏写了标记（见「已知限制」）

## 已知限制

- 预测由主模型顺带生成，模型偶尔会漏写，尤其是上下文很长的会话。插件不会补算，也不会额外请求模型。
- 标记行在流式输出瞬间可能短暂可见，落定后才会被 Markdown 吞掉。
- 标记会留在会话事件里（约 10 到 20 tokens），后续模型可能看到自己写过这一行。
- 没有单独配置项；如需关闭，从 profile 里移除该行或卸载包。

## 开发

```text
lib/index.js    Host 侧：注册运行时上下文
lib/client.js   浏览器侧：提取标记、绘制 ghost text、接管 Tab
cordis.patch.yml
```

包同时是 DSH 组合包（`dsh.bundle.patch`）和浏览器插件（`dsh.client`），安装后无需额外接线。

## License

MIT
