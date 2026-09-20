import assert from 'node:assert/strict'
import {test} from 'node:test'
import {type Block, type Inline, parseMarkdown} from './markdown.ts'

/**
 * The parse only — `renderMarkdown` needs a DOM and the client tests here
 * deliberately have none. Everything worth asserting about what may end up on
 * screen is decided at this level: the builder below it is a switch with one
 * arm per node kind and no decisions of its own.
 */
function inline(source: string): Inline[] {
  const blocks = parseMarkdown(source)
  assert.equal(blocks.length, 1, `expected one block from ${source}`)
  const block = blocks[0]
  assert.equal(block?.kind, 'paragraph')
  return block?.kind === 'paragraph' ? block.children : []
}

/** A readable shorthand for what a tree of inline nodes actually is. */
function shape(nodes: readonly Inline[]): unknown[] {
  return nodes.map(node => {
    switch (node.kind) {
      case 'text':
        return node.text
      case 'break':
        return '<br>'
      case 'code':
        return {code: node.text}
      case 'link':
        return {link: node.href, children: shape(node.children)}
      default:
        return {[node.kind]: shape(node.children)}
    }
  })
}

test('bold, italic and code', () => {
  assert.deepEqual(shape(inline('a **b** c')), ['a ', {strong: ['b']}, ' c'])
  assert.deepEqual(shape(inline('a *b* c')), ['a ', {em: ['b']}, ' c'])
  assert.deepEqual(shape(inline('a _b_ c')), ['a ', {em: ['b']}, ' c'])
  assert.deepEqual(shape(inline('a `b` c')), ['a ', {code: 'b'}, ' c'])
})

test('an http link becomes a link', () => {
  assert.deepEqual(shape(inline('see [the map](https://example.com)')), [
    'see ',
    {link: 'https://example.com', children: ['the map']},
  ])
})

test('a URL may carry balanced parentheses of its own', () => {
  // Ending the URL at the first `)` would truncate this into a different URL
  // that still passes `isHttpUrl` — a link to somewhere else, rendered as
  // though it worked, with a stray `)` after it.
  assert.deepEqual(
    shape(inline('[Mercury](https://en.wikipedia.org/wiki/Mercury_(planet))')),
    [
      {
        link: 'https://en.wikipedia.org/wiki/Mercury_(planet)',
        children: ['Mercury'],
      },
    ],
  )
})

test('a javascript: link keeps its words and loses its link', () => {
  // The whole point of routing every href through `isHttpUrl`: the text
  // survives, the scheme does not, and no anchor is ever built for it.
  assert.deepEqual(shape(inline('[click me](javascript:alert(1))')), [
    'click me',
  ])
})

test('other refused schemes are treated the same way', () => {
  for (const href of [
    'data:text/html,<script>',
    'vbscript:msgbox',
    'file:///',
  ]) {
    const nodes = inline(`[x](${href})`)
    assert.equal(
      nodes.some(node => node.kind === 'link'),
      false,
      `${href} must not become a link`,
    )
  }
})

test('raw HTML is literal text, never markup', () => {
  // There is no parse step for this to survive — it arrives as characters and
  // leaves as characters. See the file comment on markdown.ts.
  assert.deepEqual(shape(inline('<script>alert(1)</script>')), [
    '<script>alert(1)</script>',
  ])
  assert.deepEqual(shape(inline('<img src=x onerror=alert(1)>')), [
    '<img src=x onerror=alert(1)>',
  ])
})

test('an unterminated marker is the literal character', () => {
  assert.deepEqual(shape(inline('a ** b')), ['a ** b'])
  assert.deepEqual(shape(inline('2 * 3 * 4')), ['2 * 3 * 4'])
  assert.deepEqual(shape(inline('a ` b')), ['a ` b'])
  assert.deepEqual(shape(inline('[not a link')), ['[not a link'])
  assert.deepEqual(shape(inline('[label] (spaced)')), ['[label] (spaced)'])
})

test('underscores inside a word are not emphasis', () => {
  assert.deepEqual(shape(inline('snake_case_name')), ['snake_case_name'])
})

test('code suppresses the markers inside it', () => {
  assert.deepEqual(shape(inline('`**not bold**`')), [{code: '**not bold**'}])
})

test('emphasis nests', () => {
  assert.deepEqual(shape(inline('**bold with *italic* inside**')), [
    {strong: ['bold with ', {em: ['italic']}, ' inside']},
  ])
})

test('a blank line separates paragraphs; a single newline is a break', () => {
  const blocks = parseMarkdown('one\ntwo\n\nthree')
  assert.equal(blocks.length, 2)
  assert.deepEqual(shape(children(blocks[0])), ['one', '<br>', 'two'])
  assert.deepEqual(shape(children(blocks[1])), ['three'])
})

test('bulleted and numbered lists, and the switch between them', () => {
  const blocks = parseMarkdown('- one\n- two\n1. first\n2. second')
  assert.deepEqual(
    blocks.map(block => block.kind === 'list' && block.ordered),
    [false, true],
  )
  assert.deepEqual(
    blocks.map(block =>
      block.kind === 'list' ? block.items.map(item => shape(item)) : undefined,
    ),
    [
      [['one'], ['two']],
      [['first'], ['second']],
    ],
  )
})

test('a list item carries inline markup', () => {
  const blocks = parseMarkdown('- a **b**')
  const block = blocks[0]
  assert.equal(block?.kind, 'list')
  if (block?.kind !== 'list') return
  assert.deepEqual(shape(block.items[0] ?? []), ['a ', {strong: ['b']}])
})

test('empty and whitespace-only source produces nothing', () => {
  assert.deepEqual(parseMarkdown(''), [])
  assert.deepEqual(parseMarkdown('   \n\n  '), [])
})

function children(block: Block | undefined): Inline[] {
  return block?.kind === 'paragraph' ? block.children : []
}
