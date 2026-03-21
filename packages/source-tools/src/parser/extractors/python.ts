import type Parser from 'tree-sitter'
import type { Symbol, Import, SymbolKind } from '../../tools/types.js'

type SyntaxNode = Parser.SyntaxNode

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Extract all top-level symbols from a Python AST */
export function extractSymbols(tree: Parser.Tree, filePath: string): Symbol[] {
  const symbols: Symbol[] = []
  const root = tree.rootNode

  for (const node of root.namedChildren) {
    const sym = nodeToSymbol(node, filePath)
    if (sym) symbols.push(sym)
  }

  return symbols
}

/** Extract all import statements from a Python AST */
export function extractImports(tree: Parser.Tree, filePath: string): Import[] {
  const imports: Import[] = []
  const root = tree.rootNode

  for (const node of root.namedChildren) {
    if (node.type === 'import_from_statement') {
      const imp = parseFromImport(node)
      if (imp) imports.push(imp)
    } else if (node.type === 'import_statement') {
      const imp = parseImport(node)
      if (imp) imports.push(imp)
    }
  }

  return imports
}

// ---------------------------------------------------------------------------
// Symbol extraction
// ---------------------------------------------------------------------------

function nodeToSymbol(
  node: SyntaxNode,
  filePath: string,
): Symbol | undefined {
  switch (node.type) {
    case 'function_definition':
      return buildFunctionSymbol(node, filePath)

    case 'class_definition':
      return buildClassSymbol(node, filePath)

    case 'expression_statement': {
      // Top-level assignment: `x = ...`
      const assignment = node.namedChildren.find(
        (c) => c.type === 'assignment',
      )
      if (assignment) return buildAssignmentSymbol(assignment, filePath)
      return undefined
    }

    case 'assignment':
      return buildAssignmentSymbol(node, filePath)

    case 'decorated_definition': {
      // Decorated functions/classes
      const inner = node.namedChildren.find(
        (c) =>
          c.type === 'function_definition' || c.type === 'class_definition',
      )
      if (inner) {
        const sym = nodeToSymbol(inner, filePath)
        if (sym) {
          // Adjust line range to include decorator
          sym.startLine = node.startPosition.row + 1
        }
        return sym
      }
      return undefined
    }

    default:
      return undefined
  }
}

function buildFunctionSymbol(
  node: SyntaxNode,
  filePath: string,
): Symbol | undefined {
  const name = getNodeName(node)
  if (!name) return undefined

  // Python convention: underscore prefix = private
  const exported = !name.startsWith('_')

  return {
    name,
    kind: 'function',
    exported,
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    signature: buildFunctionSignature(node),
    filePath,
    jsdoc: extractDocstring(node),
  }
}

function buildClassSymbol(
  node: SyntaxNode,
  filePath: string,
): Symbol | undefined {
  const name = getNodeName(node)
  if (!name) return undefined

  const exported = !name.startsWith('_')
  const children = extractClassMembers(node, filePath)

  return {
    name,
    kind: 'class',
    exported,
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    signature: buildClassSignature(node),
    filePath,
    jsdoc: extractDocstring(node),
    children: children.length > 0 ? children : undefined,
  }
}

function buildAssignmentSymbol(
  node: SyntaxNode,
  filePath: string,
): Symbol | undefined {
  const left = node.childForFieldName('left')
  if (!left || left.type !== 'identifier') return undefined

  const name = left.text
  const exported = !name.startsWith('_')

  return {
    name,
    kind: 'variable',
    exported,
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    signature: node.text.split('\n')[0].trim(),
    filePath,
  }
}

function extractClassMembers(
  classNode: SyntaxNode,
  filePath: string,
): Symbol[] {
  const body = classNode.childForFieldName('body')
    ?? classNode.namedChildren.find((c) => c.type === 'block')
  if (!body) return []

  const members: Symbol[] = []
  const className = getNodeName(classNode)

  for (const child of body.namedChildren) {
    if (child.type === 'function_definition') {
      const name = getNodeName(child)
      if (!name) continue

      members.push({
        name,
        kind: 'method',
        exported: !name.startsWith('_'),
        startLine: child.startPosition.row + 1,
        endLine: child.endPosition.row + 1,
        signature: buildFunctionSignature(child),
        filePath,
        parentName: className,
        jsdoc: extractDocstring(child),
      })
    } else if (child.type === 'decorated_definition') {
      const inner = child.namedChildren.find(
        (c) => c.type === 'function_definition',
      )
      if (inner) {
        const name = getNodeName(inner)
        if (!name) continue
        members.push({
          name,
          kind: 'method',
          exported: !name.startsWith('_'),
          startLine: child.startPosition.row + 1,
          endLine: inner.endPosition.row + 1,
          signature: buildFunctionSignature(inner),
          filePath,
          parentName: className,
          jsdoc: extractDocstring(inner),
        })
      }
    }
  }

  return members
}

// ---------------------------------------------------------------------------
// Signature builders
// ---------------------------------------------------------------------------

function buildFunctionSignature(node: SyntaxNode): string {
  const name = getNodeName(node)
  const params = node.childForFieldName('parameters')
  const returnType = node.childForFieldName('return_type')

  let sig = `def ${name ?? ''}${params?.text ?? '()'}`
  if (returnType) sig += ` -> ${returnType.text}`
  return sig
}

function buildClassSignature(node: SyntaxNode): string {
  const name = getNodeName(node)
  const superclasses = node.childForFieldName('superclasses')
    ?? node.namedChildren.find((c) => c.type === 'argument_list')

  let sig = `class ${name ?? ''}`
  if (superclasses) sig += superclasses.text
  return sig + ':'
}

// ---------------------------------------------------------------------------
// Import extraction
// ---------------------------------------------------------------------------

function parseFromImport(node: SyntaxNode): Import | undefined {
  const moduleNode = node.childForFieldName('module_name')
    ?? node.namedChildren.find(
      (c) => c.type === 'dotted_name' || c.type === 'relative_import',
    )

  const source = moduleNode?.text ?? ''
  const names: string[] = []

  for (const child of node.namedChildren) {
    if (child.type === 'dotted_name' && child !== moduleNode) {
      names.push(child.text)
    } else if (child.type === 'aliased_import') {
      const alias = child.childForFieldName('alias')
      const importedName = child.childForFieldName('name')
      names.push(alias?.text ?? importedName?.text ?? child.text)
    }
  }

  // Also check for `from x import y, z` pattern where names are identifiers
  if (names.length === 0) {
    for (const child of node.namedChildren) {
      if (child.type === 'dotted_name' && child !== moduleNode) {
        names.push(child.text)
      }
    }
  }

  return {
    names,
    source,
    isExternal: !source.startsWith('.'),
    line: node.startPosition.row + 1,
  }
}

function parseImport(node: SyntaxNode): Import | undefined {
  const names: string[] = []
  let source = ''

  for (const child of node.namedChildren) {
    if (child.type === 'dotted_name') {
      source = child.text
      names.push(child.text)
    } else if (child.type === 'aliased_import') {
      const alias = child.childForFieldName('alias')
      const importedName = child.childForFieldName('name')
      source = importedName?.text ?? child.text
      names.push(alias?.text ?? source)
    }
  }

  return {
    names,
    source,
    isExternal: !source.startsWith('.'),
    line: node.startPosition.row + 1,
  }
}

// ---------------------------------------------------------------------------
// Docstring extraction
// ---------------------------------------------------------------------------

function extractDocstring(node: SyntaxNode): string | undefined {
  // In Python, docstrings are the first expression in the body
  const body = node.childForFieldName('body')
    ?? node.namedChildren.find((c) => c.type === 'block')
  if (!body) return undefined

  const firstChild = body.namedChildren[0]
  if (!firstChild || firstChild.type !== 'expression_statement') return undefined

  const expr = firstChild.namedChildren[0]
  if (!expr || expr.type !== 'string') return undefined

  const text = expr.text
  if (!text.startsWith('"""') && !text.startsWith("'''")) return undefined

  // Extract first meaningful line
  const content = text
    .replace(/^("""|''')\s*/, '')
    .replace(/\s*("""|''')$/, '')
  const firstLine = content.split('\n')[0].trim()
  return firstLine || undefined
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function getNodeName(node: SyntaxNode): string | undefined {
  const nameNode = node.childForFieldName('name')
  return nameNode?.text
}
