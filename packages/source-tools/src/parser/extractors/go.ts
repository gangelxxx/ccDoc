import type Parser from 'tree-sitter'
import type { Symbol, Import } from '../../tools/types.js'

type SyntaxNode = Parser.SyntaxNode

function pushIfDefined<T>(arr: T[], item: T | undefined): void {
  if (item !== undefined) arr.push(item)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Extract all top-level symbols from a Go AST */
export function extractSymbols(tree: Parser.Tree, filePath: string): Symbol[] {
  const symbols: Symbol[] = []
  const root = tree.rootNode

  for (const node of root.namedChildren) {
    switch (node.type) {
      case 'function_declaration':
        pushIfDefined(symbols, buildFunctionSymbol(node, filePath))
        break

      case 'method_declaration':
        pushIfDefined(symbols, buildMethodSymbol(node, filePath))
        break

      case 'type_declaration':
        symbols.push(...extractTypeDeclarations(node, filePath))
        break

      case 'var_declaration':
      case 'const_declaration':
        symbols.push(...extractVarConst(node, filePath))
        break
    }
  }

  return symbols
}

/** Extract all import declarations from a Go AST */
export function extractImports(tree: Parser.Tree, filePath: string): Import[] {
  const imports: Import[] = []
  const root = tree.rootNode

  for (const node of root.namedChildren) {
    if (node.type === 'import_declaration') {
      imports.push(...parseImportDeclaration(node))
    }
  }

  return imports
}

// ---------------------------------------------------------------------------
// Symbol extraction
// ---------------------------------------------------------------------------

function buildFunctionSymbol(
  node: SyntaxNode,
  filePath: string,
): Symbol | undefined {
  const name = getNodeName(node)
  if (!name) return undefined

  return {
    name,
    kind: 'function',
    exported: isExportedName(name),
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    signature: getTextUntilBody(node),
    filePath,
    jsdoc: extractGoDoc(node),
  }
}

function buildMethodSymbol(
  node: SyntaxNode,
  filePath: string,
): Symbol | undefined {
  const name = getNodeName(node)
  if (!name) return undefined

  // Get the receiver type for parentName
  const receiver = node.childForFieldName('receiver')
    ?? node.namedChildren.find((c) => c.type === 'parameter_list')
  let parentName: string | undefined
  if (receiver) {
    // Extract type name from receiver, e.g., `(s *Server)` → `Server`
    const typeNode = findTypeInReceiver(receiver)
    parentName = typeNode
  }

  return {
    name,
    kind: 'method',
    exported: isExportedName(name),
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    signature: getTextUntilBody(node),
    filePath,
    parentName,
    jsdoc: extractGoDoc(node),
  }
}

function extractTypeDeclarations(
  node: SyntaxNode,
  filePath: string,
): Symbol[] {
  const symbols: Symbol[] = []

  for (const spec of node.namedChildren) {
    if (spec.type !== 'type_spec') continue

    const name = getNodeName(spec)
    if (!name) continue

    const typeNode = spec.childForFieldName('type')
    if (!typeNode) continue

    let kind: Symbol['kind'] = 'type'
    if (typeNode.type === 'struct_type') kind = 'class'
    else if (typeNode.type === 'interface_type') kind = 'interface'

    symbols.push({
      name,
      kind,
      exported: isExportedName(name),
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      signature: buildTypeSignature(name, typeNode),
      filePath,
      jsdoc: extractGoDoc(node),
    })
  }

  return symbols
}

function extractVarConst(
  node: SyntaxNode,
  filePath: string,
): Symbol[] {
  const symbols: Symbol[] = []

  // var/const declarations can have multiple specs
  for (const child of node.namedChildren) {
    if (child.type !== 'var_spec' && child.type !== 'const_spec') continue

    const nameNode = child.childForFieldName('name')
      ?? child.namedChildren.find((c) => c.type === 'identifier')
    if (!nameNode) continue

    const name = nameNode.text

    symbols.push({
      name,
      kind: 'variable',
      exported: isExportedName(name),
      startLine: child.startPosition.row + 1,
      endLine: child.endPosition.row + 1,
      signature: child.text.split('\n')[0].trim(),
      filePath,
    })
  }

  return symbols
}

// ---------------------------------------------------------------------------
// Signature builders
// ---------------------------------------------------------------------------

function buildTypeSignature(name: string, typeNode: SyntaxNode): string {
  if (typeNode.type === 'struct_type') {
    return `type ${name} struct`
  }
  if (typeNode.type === 'interface_type') {
    return `type ${name} interface`
  }
  // For type aliases and other types
  const text = typeNode.text
  if (text.length <= 80) return `type ${name} ${text.replace(/\n/g, ' ').trim()}`
  return `type ${name} ...`
}

// ---------------------------------------------------------------------------
// Import extraction
// ---------------------------------------------------------------------------

function parseImportDeclaration(node: SyntaxNode): Import[] {
  const imports: Import[] = []

  for (const child of node.namedChildren) {
    if (child.type === 'import_spec') {
      const imp = parseImportSpec(child, node.startPosition.row + 1)
      if (imp) imports.push(imp)
    } else if (child.type === 'import_spec_list') {
      for (const spec of child.namedChildren) {
        if (spec.type === 'import_spec') {
          const imp = parseImportSpec(spec, spec.startPosition.row + 1)
          if (imp) imports.push(imp)
        }
      }
    }
  }

  // Single import without spec list: `import "fmt"`
  if (imports.length === 0) {
    const interpreted = node.namedChildren.find(
      (c) => c.type === 'interpreted_string_literal',
    )
    if (interpreted) {
      const source = interpreted.text.replace(/^"|"$/g, '')
      imports.push({
        names: [source.split('/').pop() ?? source],
        source,
        isExternal: isExternalGoImport(source),
        line: node.startPosition.row + 1,
      })
    }
  }

  return imports
}

function parseImportSpec(node: SyntaxNode, fallbackLine: number): Import | undefined {
  const pathNode = node.childForFieldName('path')
    ?? node.namedChildren.find((c) => c.type === 'interpreted_string_literal')
  if (!pathNode) return undefined

  const source = pathNode.text.replace(/^"|"$/g, '')
  const alias = node.childForFieldName('name')
  const name = alias?.text ?? source.split('/').pop() ?? source

  return {
    names: [name],
    source,
    isExternal: isExternalGoImport(source),
    line: node.startPosition.row + 1 || fallbackLine,
  }
}

// ---------------------------------------------------------------------------
// Go doc comment extraction
// ---------------------------------------------------------------------------

function extractGoDoc(node: SyntaxNode): string | undefined {
  const prev = node.previousNamedSibling
  if (!prev || prev.type !== 'comment') return undefined

  const text = prev.text
  // Go doc comments start with //
  if (text.startsWith('//')) {
    const content = text.replace(/^\/\/\s?/, '').trim()
    return content || undefined
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

/** In Go, exported names start with an uppercase letter */
function isExportedName(name: string): boolean {
  if (name.length === 0) return false
  const firstChar = name.charCodeAt(0)
  return firstChar >= 65 && firstChar <= 90 // A-Z
}

function getTextUntilBody(node: SyntaxNode): string {
  const text = node.text
  const braceIdx = text.indexOf('{')
  if (braceIdx === -1) return text.split('\n')[0].trim()
  return text.slice(0, braceIdx).replace(/\n/g, ' ').trim()
}

/**
 * Go external imports typically contain a dot in the path (e.g., "github.com/...")
 * while standard library imports don't (e.g., "fmt", "net/http").
 * For simplicity: anything with a dot in the first path segment is external.
 */
function isExternalGoImport(source: string): boolean {
  const firstSegment = source.split('/')[0]
  return firstSegment.includes('.')
}

/**
 * Extract the type name from a method receiver parameter list.
 * E.g., `(s *Server)` → `Server`, `(r Reader)` → `Reader`
 */
function findTypeInReceiver(receiver: SyntaxNode): string | undefined {
  const text = receiver.text
  // Match pattern like (*TypeName) or (TypeName) or (v *TypeName)
  const match = text.match(/\*?([A-Z]\w*)/)
  return match?.[1]
}
