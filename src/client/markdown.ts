import {isHttpUrl} from '../shared/map-file.ts'

/**
 * The small Markdown subset a Summary and a Pin's description are written in,
 * parsed to a tree of plain objects and then built as DOM nodes.
 *
 * **Nothing in this file produces an HTML string, and `innerHTML` must never
 * appear in it.** That is the whole security argument and the entire reason
 * there is no sanitizer anywhere near this text: the builder calls
 * `createElement` and sets `textContent` on the leaves, so the set of elements
 * that can ever exist is the set named in {@link appendInline}. There is no
 * parse step for a payload to survive, so there is nothing to filter. Switching
 * to building a string and assigning it would reintroduce XSS *and* quietly
 * delete the reason this code needs no defence against it. See ADR-0020.
 *
 * The parse is kept separate from the building so it can be tested without a
 * DOM — the other client tests here never touch `document`, and this one should
 * not be the reason a shim arrives.
 */
export type Inline =
  | {kind: 'text'; text: string}
  | {kind: 'strong'; children: Inline[]}
  | {kind: 'em'; children: Inline[]}
  | {kind: 'code'; text: string}
  | {kind: 'link'; href: string; children: Inline[]}
  | {kind: 'break'}

export type Block =
  | {kind: 'paragraph'; children: Inline[]}
  | {kind: 'list'; ordered: boolean; items: Inline[][]}

/** How a rendered link is opened; see {@link renderMarkdown}. */
export type MarkdownHandlers = {onOpenLink(url: string): void}

/**
 * The supported subset, and nothing else: paragraphs, `**bold**`, `*italic*`
 * and `_italic_`, `` `code` ``, `-`/`*` and `1.` lists, `[text](url)`, and a
 * single newline inside a paragraph as a line break.
 *
 * Everything else — headings, images, blockquotes, tables, reference links,
 * and raw HTML — is not a feature and is returned as the literal characters
 * that were typed. An unterminated `**` is two asterisks, not an error.
 */
export function parseMarkdown(source: string): Block[] {
  const blocks: Block[] = []
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  let paragraph: string[] = []
  let list: {ordered: boolean; items: string[]} | undefined

  function endParagraph(): void {
    if (!paragraph.length) return
    const children = parseInline(paragraph.join('\n'))
    if (children.length) blocks.push({kind: 'paragraph', children})
    paragraph = []
  }

  function endList(): void {
    if (!list) return
    blocks.push({
      kind: 'list',
      ordered: list.ordered,
      items: list.items.map(parseInline),
    })
    list = undefined
  }

  for (const line of lines) {
    const item = readListItem(line)
    if (item) {
      endParagraph()
      // A bulleted run and a numbered one are two lists, not one with mixed
      // markers, so the kind changing ends the list that was open.
      if (list && list.ordered !== item.ordered) endList()
      if (!list) list = {ordered: item.ordered, items: []}
      list.items.push(item.text)
      continue
    }
    endList()
    if (!line.trim()) {
      endParagraph()
      continue
    }
    paragraph.push(line.trim())
  }
  endParagraph()
  endList()
  return blocks
}

/**
 * The parsed source as nodes, ready to append. Links are given to
 * `handlers.onOpenLink` rather than left to navigate: a web view is a sandboxed
 * frame where an ordinary `href` either does nothing or tries to break out of
 * it, so every link in this app goes through Devvit's `navigateTo` — which is
 * what the Pin Card's own link already does. Taking the handler as a parameter
 * is what keeps this module free of app knowledge.
 */
export function renderMarkdown(
  source: string,
  handlers: MarkdownHandlers,
): DocumentFragment {
  const fragment = document.createDocumentFragment()
  for (const block of parseMarkdown(source)) {
    fragment.append(buildBlock(block, handlers))
  }
  return fragment
}

function buildBlock(block: Block, handlers: MarkdownHandlers): HTMLElement {
  if (block.kind === 'list') {
    const list = document.createElement(block.ordered ? 'ol' : 'ul')
    for (const item of block.items) {
      const entry = document.createElement('li')
      appendInline(entry, item, handlers)
      list.append(entry)
    }
    return list
  }
  const paragraph = document.createElement('p')
  appendInline(paragraph, block.children, handlers)
  return paragraph
}

/** The one place that decides which elements can exist; see the file comment. */
function appendInline(
  parent: Node,
  nodes: readonly Inline[],
  handlers: MarkdownHandlers,
): void {
  for (const node of nodes) {
    switch (node.kind) {
      case 'text':
        parent.appendChild(document.createTextNode(node.text))
        break
      case 'break':
        parent.appendChild(document.createElement('br'))
        break
      case 'code': {
        const code = document.createElement('code')
        code.textContent = node.text
        parent.appendChild(code)
        break
      }
      case 'strong':
      case 'em': {
        const element = document.createElement(
          node.kind === 'strong' ? 'strong' : 'em',
        )
        appendInline(element, node.children, handlers)
        parent.appendChild(element)
        break
      }
      case 'link': {
        const anchor = document.createElement('a')
        // Safe to set: `parseInline` only ever emits a link whose href already
        // passed `isHttpUrl`.
        anchor.href = node.href
        anchor.rel = 'noopener noreferrer'
        if (node.children.length) {
          appendInline(anchor, node.children, handlers)
        } else anchor.textContent = node.href
        const {href} = node
        anchor.addEventListener('click', event => {
          event.preventDefault()
          // The Pin Card is a `role="button"` that selects on click; without
          // this, following a link would also select the Pin under it.
          event.stopPropagation()
          handlers.onOpenLink(href)
        })
        parent.appendChild(anchor)
        break
      }
    }
  }
}

function parseInline(source: string): Inline[] {
  const out: Inline[] = []
  let buffer = ''
  let at = 0

  function flush(): void {
    if (!buffer) return
    out.push({kind: 'text', text: buffer})
    buffer = ''
  }

  while (at < source.length) {
    const char = source.charAt(at)

    if (char === '\n') {
      flush()
      out.push({kind: 'break'})
      at++
      continue
    }

    // Code first: it suppresses everything inside it, which is the one thing
    // that makes `` `**not bold**` `` behave.
    if (char === '`') {
      const end = source.indexOf('`', at + 1)
      if (end > at + 1) {
        flush()
        out.push({kind: 'code', text: source.slice(at + 1, end)})
        at = end + 1
        continue
      }
    }

    if (char === '[') {
      const link = readLink(source, at)
      if (link) {
        flush()
        const children = parseInline(link.label)
        // A URL this app would refuse keeps its words and loses its link,
        // rather than taking the reader's text with it. `isHttpUrl` is the same
        // rule `normalizeLink` holds a typed link to — one rule, not two that
        // can drift.
        if (isHttpUrl(link.href)) {
          out.push({kind: 'link', href: link.href, children})
        } else out.push(...children)
        at = link.end
        continue
      }
    }

    if (char === '*' && source.charAt(at + 1) === '*') {
      const end = source.indexOf('**', at + 2)
      if (end > at + 2) {
        flush()
        out.push({
          kind: 'strong',
          children: parseInline(source.slice(at + 2, end)),
        })
        at = end + 2
        continue
      }
    }

    if ((char === '*' || char === '_') && opensEmphasis(source, at)) {
      const end = source.indexOf(char, at + 1)
      if (end > at + 1) {
        flush()
        out.push({kind: 'em', children: parseInline(source.slice(at + 1, end))})
        at = end + 1
        continue
      }
    }

    buffer += char
    at++
  }

  flush()
  return out
}

/**
 * Whether the marker at `at` opens emphasis. An underscore has to be at a word
 * boundary, so that `snake_case_names` stay themselves; an asterisk does not,
 * since nothing writes one mid-word by accident. Neither opens on whitespace,
 * which is what keeps `2 * 3 * 4` from becoming emphasis.
 */
function opensEmphasis(source: string, at: number): boolean {
  const next = source.charAt(at + 1)
  if (!next || /\s/.test(next)) return false
  if (source.charAt(at) === '*') return true
  const previous = source.charAt(at - 1)
  return at === 0 || /[\s(]/.test(previous)
}

/**
 * A link's parts, or nothing where this `[` does not open one.
 *
 * The URL ends at the parenthesis closing the one the label opened, not at the
 * first `)` in the text. A real URL carries balanced parentheses of its own —
 * `…/wiki/Mercury_(planet)` is the ordinary case — and stopping at the first
 * one truncates it into a *different* URL that is still perfectly valid, so it
 * would pass `isHttpUrl` and render as a working link pointing somewhere else,
 * with a stray `)` left behind it. Refusing a link is visible; quietly
 * rewriting one is not.
 */
function readLink(
  source: string,
  at: number,
): {label: string; href: string; end: number} | undefined {
  const labelEnd = source.indexOf(']', at + 1)
  if (labelEnd < 0 || source.charAt(labelEnd + 1) !== '(') return
  const hrefStart = labelEnd + 2
  let depth = 0
  for (let scan = hrefStart; scan < source.length; scan++) {
    const char = source.charAt(scan)
    if (char === '(') {
      depth++
      continue
    }
    if (char !== ')') continue
    if (depth > 0) {
      depth--
      continue
    }
    return {
      label: source.slice(at + 1, labelEnd),
      href: source.slice(hrefStart, scan).trim(),
      end: scan + 1,
    }
  }
  // Never closed, so this was never a link: the `[` stays a `[`.
  return undefined
}

function readListItem(
  line: string,
): {ordered: boolean; text: string} | undefined {
  const bullet = /^ {0,3}[-*]\s+(.*)$/.exec(line)
  if (bullet) return {ordered: false, text: bullet[1] ?? ''}
  const numbered = /^ {0,3}\d+\.\s+(.*)$/.exec(line)
  if (numbered) return {ordered: true, text: numbered[1] ?? ''}
  return undefined
}
