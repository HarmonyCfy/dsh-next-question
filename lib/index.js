/**
 * Host half of dsh-next-question.
 *
 * The prediction rides the main model's own reply, so there is no second model
 * call and no extra round-trip. The instruction is registered as runtime
 * context next to the newest user message: long sessions with compaction
 * ignore system-prompt instructions, while a nearby reminder keeps its
 * attention weight.
 *
 * The marker uses the quoted-title form of a CommonMark link reference
 * definition. The parenthesis form is also a definition, but a prediction
 * containing brackets (for example `fix(test)`) closes the title early and the
 * whole line then renders as ordinary text; the quoted form survives brackets.
 */

export const name = 'dsh-next-question'

/** Wait for the prompt registry before applying. */
export const inject = ['systemPrompt']

const CONTEXT_NAME = 'ui:next-question'

/** Rendered after the built-in runtime facts. */
const CONTEXT_ORDER = 19000

/*
 * Kept deliberately short: every token here is paid on every turn. The marker
 * is hidden by the transcript renderer, and the browser half reads it from the
 * session event stream.
 */
const INSTRUCTION = `## 回答尾部固定格式
总结块写完后，必须先输出一个空行，再另起一段只写下面这一行。这一行不能带 > 前缀，不能和总结块或任何其他文字在同一行，也不要写进代码块。尖括号部分替换成真正的预测内容（里面可以有括号）：
[//]: # "nextq: <用户下一句最可能发送的话>"
用用户当前语言，不超过 40 个汉字。引号必须是英文双引号，预测内容里不要再出现双引号或换行。必须输出，不要解释。
`

export function apply(ctx) {
  ctx.effect(() => ctx.systemPrompt.context({
    name: CONTEXT_NAME,
    order: CONTEXT_ORDER,
    text: INSTRUCTION,
  }), 'next-question.context()')
}
