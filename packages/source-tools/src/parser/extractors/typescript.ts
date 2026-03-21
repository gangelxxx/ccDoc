import type Parser from 'tree-sitter'
import type { Symbol, Import, SymbolKind } from '../../tools/types.js'

type SyntaxNode = Parser.SyntaxNode

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Extract all top-level symbols (and their children) from a TS/JS AST */
export function extractSymbols(tree: Parser.Tree, filePath: string): Symbol[] {
  const symbols: Symbol[] = []
  const root = tree.rootNode

  for (const node of root.namedChildren) {
    if (node.type === 'export_statement') {
      const decl = getExportedDeclaration(node)
      if (decl) {
        // JSDoc comment is a sibling of export_statement, not of the declaration inside it
        const sym = nodeToSymbol(decl, filePath, true, node)
        if (sym) symbols.push(sym)
      }
    } else {
      const sym = nodeToSymbol(node, filePath, false)
      if (sym) symbols.push(sym)
    }
  }

  return symbols
}

/** Extract all import statements from a TS/JS AST */
export function extractImports(tree: Parser.Tree, filePath: string): Import[] {
  const imports: Import[] = []
  const root = tree.rootNode

  for (const node of root.namedChildren) {
    if (node.type === 'import_statement') {
      const imp = parseImportStatement(node)
      if (imp) imports.push(imp)
    }
  }

  return imports
}

// ---------------------------------------------------------------------------
// Symbol extraction helpers
// ---------------------------------------------------------------------------

function nodeToSymbol(
  node: SyntaxNode,
  filePath: string,
  exported: boolean,
  jsdocSourceNode?: SyntaxNode,
): Symbol | undefined {
  const jsdocNode = jsdocSourceNode ?? node
  switch (node.type) {
    case 'function_declaration':
    case 'generator_function_declaration':
      return buildSymbol(node, 'function', exported, filePath, jsdocNode)

    case 'class_declaration':
      return buildClassSymbol(node, exported, filePath, jsdocNode)

    case 'interface_declaration':
      return buildSymbol(node, 'interface', exported, filePath, jsdocNode)

    case 'type_alias_declaration':
      return buildSymbol(node, 'type', exported, filePath, jsdocNode)

    case 'lexical_declaration':
      return buildVariableSymbol(node, exported, filePath, jsdocNode)

    case 'enum_declaration':
      return buildSymbol(node, 'enum', exported, filePath, jsdocNode)

    case 'abstract_class_declaration':
      return buildClassSymbol(node, exported, filePath, jsdocNode)

    default:
      return undefined
  }
}

function buildSymbol(
  node: SyntaxNode,
  kind: SymbolKind,
  exported: boolean,
  filePath: string,
  jsdocNode?: SyntaxNode,
): Symbol | undefined {
  const name = getNodeName(node)
  if (!name) return undefined

  return {
    name,
    kind,
    exported,
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    signature: buildSignature(node, kind),
    filePath,
    jsdoc: extractJsdoc(jsdocNode ?? node),
  }
}

function buildClassSymbol(
  node: SyntaxNode,
  exported: boolean,
  filePath: string,
  jsdocNode?: SyntaxNode,
): Symbol | undefined {
  const name = getNodeName(node)
  if (!name) return undefined

  const children = extractClassMembers(node, filePath)

  return {
    name,
    kind: 'class',
    exported,
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    signature: buildClassSignature(node),
    filePath,
    jsdoc: extractJsdoc(jsdocNode ?? node),
    children: children.length > 0 ? children : undefined,
  }
}

function buildVariableSymbol(
  node: SyntaxNode,
  exported: boolean,
  filePath: string,
  jsdocNode?: SyntaxNode,
): Symbol | undefined {
  // lexical_declaration contains variable_declarator children
  const declarator = node.namedChildren.find(
    (c) => c.type === 'variable_declarator',
  )
  if (!declarator) return undefined

  const nameNode = declarator.childForFieldName('name')
  const name = nameNode?.text
  if (!name) return undefined

  return {
    name,
    kind: 'variable',
    exported,
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    signature: buildVariableSignature(node, declarator),
    filePath,
    jsdoc: extractJsdoc(jsdocNode ?? node),
  }
}

function extractClassMembers(
  classNode: SyntaxNode,
  filePath: string,
): Symbol[] {
  const body = classNode.childForFieldName('body')
  if (!body) return []

  const members: Symbol[] = []

  for (const child of body.namedChildren) {
    if (child.type === 'method_definition') {
      const name = getNodeName(child)
      if (!name) continue
      members.push({
        name,
        kind: 'method',
        exported: false,
        startLine: child.startPosition.row + 1,
        endLine: child.endPosition.row + 1,
        signature: getTextUntilBody(child),
        filePath,
        parentName: getNodeName(classNode),
        jsdoc: extractJsdoc(child),
      })
    } else if (
      child.type === 'public_field_definition' ||
      child.type === 'property_definition'
    ) {
      const name = getPropertyName(child)
      if (!name) continue
      members.push({
        name,
        kind: 'property',
        exported: false,
        startLine: child.startPosition.row + 1,
        endLine: child.endPosition.row + 1,
        signature: child.text.split('\n')[0].trim(),
        filePath,
        parentName: getNodeName(classNode),
      })
    }
  }

  return members
}

// ---------------------------------------------------------------------------
// Signature builders
// ---------------------------------------------------------------------------

function buildSignature(node: SyntaxNode, kind: SymbolKind): string {
  switch (kind) {
    case 'function':
      return getTextUntilBody(node)

    case 'interface':
      return buildInterfaceSignature(node)

    case 'type':
      return buildTypeSignature(node)

    case 'enum':
      return buildEnumSignature(node)

    default:
      return getSignatureLine(node)
  }
}

function buildClassSignature(node: SyntaxNode): string {
  const parts: string[] = []

  if (node.type === 'abstract_class_declaration') {
    parts.push('abstract ')
  }

  parts.push('class ')

  const name = getNodeName(node)
  if (name) parts.push(name)

  // extends clause
  const heritage = node.childForFieldName('superclass')
    ?? node.namedChildren.find((c) => c.type === 'extends_clause')
  if (heritage) {
    parts.push(` extends ${heritage.text}`)
  }

  // implements clause
  const impl = node.namedChildren.find(
    (c) => c.type === 'implements_clause',
  )
  if (impl) {
    parts.push(` ${impl.text}`)
  }

  // Type parameters
  const typeParams = node.namedChildren.find(
    (c) => c.type === 'type_parameters',
  )
  if (typeParams) {
    // Insert type params after name
    const nameStr = name ?? ''
    const idx = parts.findIndex((p) => p === nameStr)
    if (idx >= 0) {
      parts.splice(idx + 1, 0, typeParams.text)
    }
  }

  return parts.join('').trim()
}

function buildInterfaceSignature(node: SyntaxNode): string {
  const body = node.childForFieldName('body')
    ?? node.namedChildren.find((c) => c.type === 'object_type' || c.type === 'interface_body')

  if (!body) return getSignatureLine(node)

  const fields = body.namedChildren.filter(
    (c) => c.type === 'property_signature' || c.type === 'method_signature',
  )

  const name = getNodeName(node)
  const typeParams = node.namedChildren.find((c) => c.type === 'type_parameters')
  const prefix = `interface ${name ?? ''}${typeParams?.text ?? ''}`
  const extendsClause = node.namedChildren.find((c) => c.type === 'extends_type_clause')
  const ext = extendsClause ? ` ${extendsClause.text}` : ''

  if (fields.length <= 5) {
    const fieldTexts = fields.map((f) => f.text.replace(/\n/g, ' ').trim())
    return `${prefix}${ext} { ${fieldTexts.join('; ')} }`
  }

  return `${prefix}${ext} { /* ${fields.length} members */ }`
}

function buildTypeSignature(node: SyntaxNode): string {
  const text = node.text
  if (text.length <= 100) return text.replace(/\n/g, ' ').trim()

  // Truncate long type aliases
  const firstLine = getSignatureLine(node)
  return firstLine + ' ...'
}

function buildEnumSignature(node: SyntaxNode): string {
  const body = node.namedChildren.find((c) => c.type === 'enum_body')
  if (!body) return getSignatureLine(node)

  const members = body.namedChildren.filter(
    (c) => c.type === 'enum_assignment' || c.type === 'property_identifier',
  )

  const name = getNodeName(node)
  if (members.length <= 5) {
    const values = members.map((m) => m.text.trim())
    return `enum ${name ?? ''} { ${values.join(', ')} }`
  }

  return `enum ${name ?? ''} { /* ${members.length} members */ }`
}

function buildVariableSignature(
  declNode: SyntaxNode,
  declarator: SyntaxNode,
): string {
  // Get the keyword (const/let/var)
  const keyword = declNode.namedChildren.length > 0
    ? declNode.text.slice(0, declNode.text.indexOf(declarator.text)).trim()
    : 'const'

  const nameNode = declarator.childForFieldName('name')
  const name = nameNode?.text ?? ''

  // Type annotation
  const typeAnnotation = declarator.namedChildren.find(
    (c) => c.type === 'type_annotation',
  )
  const typeStr = typeAnnotation ? typeAnnotation.text : ''

  // Value — show abbreviated form for objects/arrays/functions
  const value = declarator.childForFieldName('value')
  if (!value) return `${keyword} ${name}${typeStr}`

  const valueText = value.text
  if (
    value.type === 'object' ||
    value.type === 'array' ||
    value.type === 'arrow_function' ||
    value.type === 'function'
  ) {
    if (valueText.length > 60) {
      const abbreviated =
        value.type === 'arrow_function' || value.type === 'function'
          ? getTextUntilBodyFromText(valueText)
          : '{ ... }'
      return `${keyword} ${name}${typeStr} = ${abbreviated}`
    }
  }

  const full = `${keyword} ${name}${typeStr} = ${valueText}`
  if (full.length <= 100) return full.replace(/\n/g, ' ').trim()

  return `${keyword} ${name}${typeStr} = ...`
}

// ---------------------------------------------------------------------------
// Import extraction helpers
// ---------------------------------------------------------------------------

function parseImportStatement(node: SyntaxNode): Import | undefined {
  const source = getImportSource(node)
  if (!source) return undefined

  const names: string[] = []

  const importClause = node.namedChildren.find(
    (c) => c.type === 'import_clause',
  )

  if (importClause) {
    for (const child of importClause.namedChildren) {
      if (child.type === 'identifier') {
        // default import
        names.push(child.text)
      } else if (child.type === 'named_imports') {
        for (const spec of child.namedChildren) {
          if (spec.type === 'import_specifier') {
            const alias = spec.childForFieldName('alias')
            const importedName = spec.childForFieldName('name')
            names.push(alias?.text ?? importedName?.text ?? spec.text)
          }
        }
      } else if (child.type === 'namespace_import') {
        const nameNode = child.namedChildren.find((c) => c.type === 'identifier')
        if (nameNode) names.push(`* as ${nameNode.text}`)
      }
    }
  }

  return {
    names,
    source,
    isExternal: !source.startsWith('.') && !source.startsWith('/'),
    line: node.startPosition.row + 1,
  }
}

function getImportSource(node: SyntaxNode): string | undefined {
  // The source is usually in a string/string_fragment child
  const sourceNode = node.childForFieldName('source')
  if (sourceNode) {
    // Strip quotes
    return sourceNode.text.replace(/^['"]|['"]$/g, '')
  }

  // Fallback: look for a string node
  const stringNode = node.namedChildren.find((c) => c.type === 'string')
  if (stringNode) {
    const fragment = stringNode.namedChildren.find(
      (c) => c.type === 'string_fragment',
    )
    return fragment?.text ?? stringNode.text.replace(/^['"]|['"]$/g, '')
  }

  return undefined
}

// ---------------------------------------------------------------------------
// JSDoc extraction
// ---------------------------------------------------------------------------

function extractJsdoc(node: SyntaxNode): string | undefined {
  const prev = node.previousNamedSibling
  if (!prev || prev.type !== 'comment') return undefined

  const text = prev.text
  if (!text.startsWith('/**')) return undefined

  // Extract first meaningful line after the opening /**
  const lines = text.split('\n')
  for (const line of lines) {
    const cleaned = line
      .replace(/^\/\*\*\s*/, '')
      .replace(/^\s*\*\/?/, '')
      .replace(/\*\/\s*$/, '')
      .trim()
    if (cleaned.length > 0 && !cleaned.startsWith('@')) {
      return cleaned
    }
  }

  return undefined
}

// ---------------------------------------------------------------------------
// Node utilities
// ---------------------------------------------------------------------------

function getNodeName(node: SyntaxNode): string | undefined {
  const nameNode = node.childForFieldName('name')
  return nameNode?.text
}

function getPropertyName(node: SyntaxNode): string | undefined {
  const nameNode = node.childForFieldName('name')
    ?? node.namedChildren.find((c) => c.type === 'property_identifier')
  return nameNode?.text
}

/**
 * Get the declaration inside an export_statement.
 * Handles: `export function ...`, `export class ...`,
 * `export default ...`, `export const ...`, etc.
 */
function getExportedDeclaration(node: SyntaxNode): SyntaxNode | undefined {
  const declaration = node.childForFieldName('declaration')
  if (declaration) return declaration

  // Sometimes the declaration is just a named child
  for (const child of node.namedChildren) {
    if (
      child.type === 'function_declaration' ||
      child.type === 'class_declaration' ||
      child.type === 'abstract_class_declaration' ||
      child.type === 'interface_declaration' ||
      child.type === 'type_alias_declaration' ||
      child.type === 'lexical_declaration' ||
      child.type === 'enum_declaration' ||
      child.type === 'generator_function_declaration'
    ) {
      return child
    }
  }

  return undefined
}

/** Get text from node start to the first `{` character, trimmed */
function getTextUntilBody(node: SyntaxNode): string {
  return getTextUntilBodyFromText(node.text)
}

function getTextUntilBodyFromText(text: string): string {
  const braceIdx = text.indexOf('{')
  if (braceIdx === -1) return text.split('\n')[0].trim()
  return text.slice(0, braceIdx).replace(/\n/g, ' ').trim()
}

/** Get first line of node text, trimmed */
function getSignatureLine(node: SyntaxNode): string {
  const firstLine = node.text.split('\n')[0]
  return firstLine.trim()
}
