import type Parser from 'tree-sitter'
import type { Symbol, Import, SymbolKind } from '../../tools/types.js'

type SyntaxNode = Parser.SyntaxNode

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Extract all top-level symbols from a Rust AST */
export function extractSymbols(tree: Parser.Tree, filePath: string): Symbol[] {
  const symbols: Symbol[] = []
  const root = tree.rootNode

  for (const node of root.namedChildren) {
    const extracted = nodeToSymbols(node, filePath)
    symbols.push(...extracted)
  }

  return symbols
}

/** Extract all use declarations from a Rust AST */
export function extractImports(tree: Parser.Tree, filePath: string): Import[] {
  const imports: Import[] = []
  const root = tree.rootNode

  for (const node of root.namedChildren) {
    if (node.type === 'use_declaration') {
      const imp = parseUseDeclaration(node)
      if (imp) imports.push(imp)
    }
  }

  return imports
}

// ---------------------------------------------------------------------------
// Symbol extraction
// ---------------------------------------------------------------------------

function nodeToSymbols(
  node: SyntaxNode,
  filePath: string,
): Symbol[] {
  switch (node.type) {
    case 'function_item':
      return wrap(buildFunctionSymbol(node, filePath))

    case 'struct_item':
      return wrap(buildStructSymbol(node, filePath))

    case 'impl_item':
      return extractImplMembers(node, filePath)

    case 'trait_item':
      return wrap(buildTraitSymbol(node, filePath))

    case 'type_item':
      return wrap(buildTypeSymbol(node, filePath))

    case 'enum_item':
      return wrap(buildEnumSymbol(node, filePath))

    case 'const_item':
    case 'static_item':
      return wrap(buildConstSymbol(node, filePath))

    // Attribute macros wrapping items
    case 'attribute_item':
      return []

    default:
      return []
  }
}

function wrap(sym: Symbol | undefined): Symbol[] {
  return sym ? [sym] : []
}

function buildFunctionSymbol(
  node: SyntaxNode,
  filePath: string,
  parentName?: string,
): Symbol | undefined {
  const name = getNodeName(node)
  if (!name) return undefined

  return {
    name,
    kind: parentName ? 'method' : 'function',
    exported: hasPubVisibility(node),
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    signature: getTextUntilBody(node),
    filePath,
    parentName,
    jsdoc: extractDocComment(node),
  }
}

function buildStructSymbol(
  node: SyntaxNode,
  filePath: string,
): Symbol | undefined {
  const name = getNodeName(node)
  if (!name) return undefined

  return {
    name,
    kind: 'class', // use 'class' for consistency across languages
    exported: hasPubVisibility(node),
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    signature: getTextUntilBody(node),
    filePath,
    jsdoc: extractDocComment(node),
  }
}

function buildTraitSymbol(
  node: SyntaxNode,
  filePath: string,
): Symbol | undefined {
  const name = getNodeName(node)
  if (!name) return undefined

  return {
    name,
    kind: 'interface',
    exported: hasPubVisibility(node),
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    signature: getTextUntilBody(node),
    filePath,
    jsdoc: extractDocComment(node),
  }
}

function buildTypeSymbol(
  node: SyntaxNode,
  filePath: string,
): Symbol | undefined {
  const name = getNodeName(node)
  if (!name) return undefined

  const text = node.text
  const sig = text.length <= 100
    ? text.replace(/\n/g, ' ').trim()
    : getSignatureLine(node) + ' ...'

  return {
    name,
    kind: 'type',
    exported: hasPubVisibility(node),
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    signature: sig,
    filePath,
    jsdoc: extractDocComment(node),
  }
}

function buildEnumSymbol(
  node: SyntaxNode,
  filePath: string,
): Symbol | undefined {
  const name = getNodeName(node)
  if (!name) return undefined

  return {
    name,
    kind: 'enum',
    exported: hasPubVisibility(node),
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    signature: getTextUntilBody(node),
    filePath,
    jsdoc: extractDocComment(node),
  }
}

function buildConstSymbol(
  node: SyntaxNode,
  filePath: string,
): Symbol | undefined {
  const name = getNodeName(node)
  if (!name) return undefined

  return {
    name,
    kind: 'variable',
    exported: hasPubVisibility(node),
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    signature: getSignatureLine(node),
    filePath,
    jsdoc: extractDocComment(node),
  }
}

/**
 * Extract methods from an `impl` block.
 * impl blocks don't have a name field directly — we get the type name.
 */
function extractImplMembers(
  node: SyntaxNode,
  filePath: string,
): Symbol[] {
  const typeNode = node.childForFieldName('type')
    ?? node.namedChildren.find(
      (c) => c.type === 'type_identifier' || c.type === 'generic_type',
    )
  const parentName = typeNode?.text

  const body = node.childForFieldName('body')
    ?? node.namedChildren.find((c) => c.type === 'declaration_list')
  if (!body) return []

  const members: Symbol[] = []

  for (const child of body.namedChildren) {
    if (child.type === 'function_item') {
      const sym = buildFunctionSymbol(child, filePath, parentName)
      if (sym) members.push(sym)
    }
  }

  return members
}

// ---------------------------------------------------------------------------
// Import extraction
// ---------------------------------------------------------------------------

function parseUseDeclaration(node: SyntaxNode): Import | undefined {
  // use declarations have complex tree structures; extract the full text
  const text = node.text.replace(/^use\s+/, '').replace(/;\s*$/, '').trim()

  const names: string[] = []
  const parts = text.split('::')
  const source = parts.slice(0, -1).join('::')
  const lastPart = parts[parts.length - 1]

  // Handle `use crate::module::{A, B}` or `use std::io::Read`
  if (lastPart.startsWith('{')) {
    const inner = lastPart.replace(/[{}]/g, '').trim()
    names.push(...inner.split(',').map((n) => n.trim()).filter(Boolean))
  } else {
    names.push(lastPart)
  }

  // External = not starting with crate/self/super
  const isExternal =
    !text.startsWith('crate') &&
    !text.startsWith('self') &&
    !text.startsWith('super')

  return {
    names,
    source: source || text,
    isExternal,
    line: node.startPosition.row + 1,
  }
}

// ---------------------------------------------------------------------------
// Doc comment extraction (/// or /** */)
// ---------------------------------------------------------------------------

function extractDocComment(node: SyntaxNode): string | undefined {
  const prev = node.previousNamedSibling
  if (!prev) return undefined

  // Rust doc comments: line_comment starting with /// or block_comment with /**
  if (prev.type === 'line_comment') {
    const text = prev.text
    if (text.startsWith('///')) {
      return text.replace(/^\/\/\/\s?/, '').trim() || undefined
    }
  }

  if (prev.type === 'block_comment') {
    const text = prev.text
    if (text.startsWith('/**')) {
      const content = text
        .replace(/^\/\*\*\s*/, '')
        .replace(/\s*\*\/\s*$/, '')
        .split('\n')[0]
        .replace(/^\s*\*\s?/, '')
        .trim()
      return content || undefined
    }
  }

  // Attribute macro above the doc comment
  if (prev.type === 'attribute_item') {
    const prevPrev = prev.previousNamedSibling
    if (prevPrev?.type === 'line_comment' && prevPrev.text.startsWith('///')) {
      return prevPrev.text.replace(/^\/\/\/\s?/, '').trim() || undefined
    }
  }

  return undefined
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function getNodeName(node: SyntaxNode): string | undefined {
  const nameNode = node.childForFieldName('name')
  return nameNode?.text
}

function hasPubVisibility(node: SyntaxNode): boolean {
  return node.namedChildren.some(
    (c) => c.type === 'visibility_modifier',
  )
}

function getTextUntilBody(node: SyntaxNode): string {
  const text = node.text
  const braceIdx = text.indexOf('{')
  if (braceIdx === -1) {
    // Might end with `;` (e.g. unit struct)
    return text.replace(/\n/g, ' ').trim()
  }
  return text.slice(0, braceIdx).replace(/\n/g, ' ').trim()
}

function getSignatureLine(node: SyntaxNode): string {
  return node.text.split('\n')[0].trim()
}
