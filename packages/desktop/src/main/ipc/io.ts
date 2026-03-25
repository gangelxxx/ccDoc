import { ipcMain, dialog, nativeImage } from "electron";
import { readFileSync } from "fs";
import { basename, extname } from "path";
import { getProjectServices, getProjectsService, trackBgTask, suppressExternalChange } from "../services";
import { getMainWindow } from "../window";

interface PdfImage {
  dataUri: string;
  width: number;
  height: number;
}

interface PdfPage {
  pageNum: number;
  text: string;
  images: PdfImage[];
}

interface PdfOutlineEntry {
  title: string;
  pageNum: number; // 1-based
  level: number;   // 0 = chapter, 1 = section, 2 = subsection, ...
}

interface PdfExtractionResult {
  pages: PdfPage[];
  outline: PdfOutlineEntry[];
}

function rgbaToPngDataUri(data: Uint8ClampedArray, width: number, height: number): string {
  // nativeImage.createFromBitmap expects BGRA, pdfjs gives RGBA — swap R↔B
  const bgra = Buffer.from(data);
  for (let i = 0; i < bgra.length; i += 4) {
    const r = bgra[i];
    bgra[i] = bgra[i + 2];
    bgra[i + 2] = r;
  }
  const img = nativeImage.createFromBitmap(bgra, { width, height });
  return `data:image/png;base64,${img.toPNG().toString("base64")}`;
}

function rgbToPngDataUri(data: Uint8ClampedArray, width: number, height: number): string {
  // Convert RGB → BGRA for nativeImage
  const bgra = Buffer.alloc(width * height * 4);
  for (let i = 0, j = 0; i < data.length; i += 3, j += 4) {
    bgra[j] = data[i + 2];     // B
    bgra[j + 1] = data[i + 1]; // G
    bgra[j + 2] = data[i];     // R
    bgra[j + 3] = 255;         // A
  }
  const img = nativeImage.createFromBitmap(bgra, { width, height });
  return `data:image/png;base64,${img.toPNG().toString("base64")}`;
}

const MIN_IMG_PIXELS = 400; // skip tiny icons/decorations (< 20x20)

/**
 * Reconstruct structured text from PDF text items using positional data.
 * Two-strategy approach:
 *   1. Column-based extraction with X-position co-occurrence analysis (handles
 *      narrow gaps like "Дата"/"Изделие" that never appear on the same line)
 *   2. Gap-based fallback (ratio-based threshold for simpler layouts)
 */
type TextItem = { str: string; x: number; y: number; width: number; height: number; color?: string; fontName?: string };

function extractStructuredText(rawItems: any[], colorMap?: Map<string, string>): string {
  const items: TextItem[] = rawItems
    .filter((it: any) => typeof it.str === "string" && it.str.trim() !== "" && it.transform)
    .map((it: any) => {
      const x = (it.transform[4] ?? 0) as number;
      const y = (it.transform[5] ?? 0) as number;
      const key = Math.round(x * 10) + "," + Math.round(y * 10);
      const color = colorMap?.get(key);
      return {
        str: it.str as string,
        x,
        y,
        width: (it.width ?? 0) as number,
        height: (Math.abs(it.transform[3]) || 10) as number,
        color,
        fontName: it.fontName as string,
      };
    });

  if (!items.length) return "";

  // Sort: top-to-bottom (desc Y), left-to-right (asc X)
  items.sort((a, b) => b.y - a.y || a.x - b.x);

  // Group into physical lines by Y proximity
  const yTol = items[0].height * 0.4;
  const lines: TextItem[][] = [];
  let curLine: TextItem[] = [items[0]];

  for (let i = 1; i < items.length; i++) {
    if (Math.abs(items[i].y - curLine[0].y) <= yTol) {
      curLine.push(items[i]);
    } else {
      curLine.sort((a, b) => a.x - b.x);
      lines.push(curLine);
      curLine = [items[i]];
    }
  }
  curLine.sort((a, b) => a.x - b.x);
  lines.push(curLine);

  // --- Strategy 1: Column-based extraction with co-occurrence analysis ---
  const columnResult = tryColumnExtraction(lines);
  if (columnResult !== null && columnResult.trim()) return columnResult;

  // --- Strategy 2: Gap-based fallback ---
  const gapResult = gapBasedExtraction(lines);
  if (gapResult.trim()) return gapResult;

  // --- Strategy 3: Raw text fallback (should never be needed) ---
  console.warn(`[pdf] extractStructuredText: both strategies returned empty for ${items.length} items, using raw fallback`);
  return lines.map(line => line.map(it => it.str).join(" ")).join("\n");
}

/** Wrap text in a color span if the item has a non-trivial color. */
function colorWrap(item: TextItem): string {
  if (item.color && item.color !== "#000000" && item.color !== "#ffffff") {
    return `<span style="color:${item.color}">${item.str}</span>`;
  }
  return item.str;
}

/** Strategy 1: detect columns by X-position bucketing + co-occurrence merge. */
function tryColumnExtraction(lines: TextItem[][]): string | null {
  if (lines.length < 6) return null;

  // 1. Bucket all item X positions (5px buckets)
  const BUCKET_W = 5;
  const bucketPresence = new Map<number, Set<number>>(); // bucket → set of line indices

  for (let li = 0; li < lines.length; li++) {
    for (const item of lines[li]) {
      const bucket = Math.round(item.x / BUCKET_W) * BUCKET_W;
      let set = bucketPresence.get(bucket);
      if (!set) { set = new Set(); bucketPresence.set(bucket, set); }
      set.add(li);
    }
  }

  // 2. Pre-merge adjacent buckets within BUCKET_W that never co-occur on the
  //    same line. This prevents a single column's items (e.g. x=557 vs x=560)
  //    from splitting into two sub-threshold buckets.
  const sortedRaw = [...bucketPresence.entries()]
    .sort((a, b) => a[0] - b[0]);
  const preMerged: { bucket: number; lineSet: Set<number> }[] = [];
  for (const [bucket, lineSet] of sortedRaw) {
    const last = preMerged[preMerged.length - 1];
    if (last && bucket - last.bucket <= BUCKET_W) {
      let overlap = false;
      for (const li of lineSet) { if (last.lineSet.has(li)) { overlap = true; break; } }
      if (!overlap) {
        for (const li of lineSet) last.lineSet.add(li);
        continue;
      }
    }
    preMerged.push({ bucket, lineSet: new Set(lineSet) });
  }

  // 3. Keep significant buckets (≥10% of lines, min 3 lines)
  const minLines = Math.max(3, Math.floor(lines.length * 0.1));
  const sigBuckets = preMerged
    .filter(e => e.lineSet.size >= minLines)
    .sort((a, b) => a.bucket - b.bucket);

  if (sigBuckets.length < 3) return null;

  // 4. Build full co-occurrence matrix (pairwise line overlap count)
  const n = sigBuckets.length;
  const cooccur: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      let count = 0;
      for (const li of sigBuckets[i].lineSet) {
        if (sigBuckets[j].lineSet.has(li)) count++;
      }
      cooccur[i][j] = count;
      cooccur[j][i] = count;
    }
  }

  // 5. Union-Find for merging non-co-occurring adjacent buckets
  const parent = sigBuckets.map((_, i) => i);
  function find(x: number): number {
    while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
    return x;
  }
  function union(a: number, b: number): void {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  }

  // Build sorted pairs by gap distance (smallest first)
  const pairs: { i: number; j: number; gap: number }[] = [];
  for (let i = 0; i < n - 1; i++) {
    const gap = sigBuckets[i + 1].bucket - sigBuckets[i].bucket;
    pairs.push({ i, j: i + 1, gap });
  }
  pairs.sort((a, b) => a.gap - b.gap);

  for (const { i, j, gap } of pairs) {
    if (cooccur[i][j] > 0 || gap > 30) continue;

    // Before merging, check that no two members of the combined group co-occur
    const ri = find(i), rj = find(j);
    if (ri === rj) continue;

    const groupI: number[] = [], groupJ: number[] = [];
    for (let k = 0; k < n; k++) {
      if (find(k) === ri) groupI.push(k);
      if (find(k) === rj) groupJ.push(k);
    }

    let conflict = false;
    for (const a of groupI) {
      for (const b of groupJ) {
        if (cooccur[a][b] > 0) { conflict = true; break; }
      }
      if (conflict) break;
    }
    if (!conflict) union(i, j);
  }

  // 5. Final columns = leftmost bucket of each union-find group, sorted
  const groupMap = new Map<number, number>(); // root → min bucket
  for (let k = 0; k < n; k++) {
    const root = find(k);
    const cur = groupMap.get(root);
    if (cur === undefined || sigBuckets[k].bucket < cur) {
      groupMap.set(root, sigBuckets[k].bucket);
    }
  }
  const colPositions = [...new Set(groupMap.values())].sort((a, b) => a - b);

  if (colPositions.length < 3) return null;

  // 6. Row grouping — merge physical lines into logical rows via Y-gap ratio
  const lineYs = lines.map(l => l.reduce((s, it) => s + it.y, 0) / l.length);
  const yGaps: number[] = [];
  for (let i = 1; i < lineYs.length; i++) {
    yGaps.push(Math.abs(lineYs[i] - lineYs[i - 1]));
  }

  let rowThreshold = Infinity;
  if (yGaps.length > 0) {
    const sorted = [...yGaps].sort((a, b) => a - b);
    // Start from the median to skip noise from tight sub-header spacing.
    // Use 1.4× ratio (not 1.5×) to catch gradual gap distributions where
    // intra-row gaps (6-14px) blend smoothly into inter-row gaps (20+px).
    const startAt = Math.max(1, Math.floor(sorted.length * 0.5));
    for (let i = startAt; i < sorted.length; i++) {
      if (sorted[i - 1] >= 1 && sorted[i] >= sorted[i - 1] * 1.4) {
        rowThreshold = (sorted[i - 1] + sorted[i]) / 2;
        break;
      }
    }
    if (rowThreshold === Infinity) {
      rowThreshold = sorted[Math.floor(sorted.length / 2)] * 1.3;
    }
  }

  const logicalRows: TextItem[][] = [];
  let currentRow = [...lines[0]];
  for (let i = 1; i < lines.length; i++) {
    if (yGaps[i - 1] <= rowThreshold) {
      currentRow.push(...lines[i]);
    } else {
      logicalRows.push(currentRow);
      currentRow = [...lines[i]];
    }
  }
  logicalRows.push(currentRow);

  if (logicalRows.length < 3) return null;

  // 7. Column boundaries = midpoints between column positions
  const numCols = colPositions.length;
  const colBounds: number[] = []; // upper boundary for each column (exclusive)
  for (let c = 0; c < numCols - 1; c++) {
    colBounds.push((colPositions[c] + colPositions[c + 1]) / 2);
  }
  colBounds.push(Infinity);

  function assignCol(x: number): number {
    for (let c = 0; c < colBounds.length; c++) {
      if (x < colBounds[c]) return c;
    }
    return numCols - 1;
  }

  // 8. Build cells per logical row
  const rowCells: string[][] = logicalRows.map(row => {
    const cells: string[] = new Array(numCols).fill("");
    // Sort items: column first, then Y descending (top-first), then X ascending
    const sorted = [...row].sort((a, b) => {
      const ca = assignCol(a.x), cb = assignCol(b.x);
      if (ca !== cb) return ca - cb;
      if (Math.abs(a.y - b.y) > 1) return b.y - a.y; // higher Y = top of page
      return a.x - b.x;
    });
    for (const item of sorted) {
      const col = assignCol(item.x);
      const txt = colorWrap(item);
      cells[col] = cells[col] ? cells[col] + " " + txt : txt;
    }
    return cells;
  });

  // 9. Table detection: count non-empty cells per row
  const fillCounts = rowCells.map(cells => cells.filter(c => c !== "").length);
  const countFreq = new Map<number, number>();
  for (const fc of fillCounts) {
    if (fc >= 3) countFreq.set(fc, (countFreq.get(fc) || 0) + 1);
  }

  let bestCount = 0, bestFreq = 0;
  for (const [count, freq] of countFreq) {
    if (freq > bestFreq) { bestCount = count; bestFreq = freq; }
  }

  // Column detection is robust (X-position + co-occurrence), so 2 rows suffice.
  if (bestFreq < 2 || bestCount < 3) return null;

  // Guard: if less than 40% of logical rows qualify as table rows, this is
  // likely indented text (bullets, sub-lists) not a real table.
  const potentialTableRows = fillCounts.filter(fc => fc >= bestCount - 1).length;
  if (potentialTableRows < logicalRows.length * 0.4) return null;

  // Rows with non-empty count >= bestCount-1 are table rows
  const preTable: string[] = [];
  const tableRows: string[][] = [];
  const overflow: string[] = [];
  let seenFirstTable = false;

  for (let r = 0; r < rowCells.length; r++) {
    const filled = fillCounts[r];
    if (filled >= bestCount - 1) {
      seenFirstTable = true;
      tableRows.push(rowCells[r]);
    } else if (!seenFirstTable) {
      preTable.push(rowCells[r].filter(c => c).join("  "));
    } else {
      overflow.push(rowCells[r].filter(c => c).join("  "));
    }
  }

  if (tableRows.length < 2) return null;

  // Quality check: if average fill rate is too low the column detection is
  // probably wrong (e.g. row grouping missed sub-lines) → fall back to gap-based.
  const totalCells = tableRows.length * numCols;
  const filledCells = tableRows.reduce((s, row) => s + row.filter(c => c).length, 0);
  if (filledCells / totalCells < 0.75) return null;

  // 10. Format as markdown table
  const result: string[] = [...preTable];
  for (let i = 0; i < tableRows.length; i++) {
    const escaped = tableRows[i].map(c => c.replace(/\|/g, "\\|"));
    result.push(`| ${escaped.join(" | ")} |`);
    if (i === 0) {
      result.push(`| ${escaped.map(() => "---").join(" | ")} |`);
    }
  }
  if (overflow.length) {
    result.push("");
    result.push(...overflow);
  }
  return result.join("\n");
}

/** Format lines as markdown with headings, bold, lists, paragraphs. */
function applyTextFormatting(lines: TextItem[][]): string {
  if (!lines.length) return "";

  // Find the most common font height (body text size) and font name (regular font)
  const heightCounts = new Map<number, number>();
  const fontCounts = new Map<string, number>();
  for (const line of lines) {
    for (const item of line) {
      const h = Math.round(item.height);
      heightCounts.set(h, (heightCounts.get(h) || 0) + 1);
      if (item.fontName) {
        fontCounts.set(item.fontName, (fontCounts.get(item.fontName) || 0) + 1);
      }
    }
  }

  // Body height = most frequent height
  let bodyHeight = 10;
  let maxCount = 0;
  for (const [h, c] of heightCounts) {
    if (c > maxCount) { bodyHeight = h; maxCount = c; }
  }

  // Regular font = most frequent font name
  let regularFont = "";
  maxCount = 0;
  for (const [f, c] of fontCounts) {
    if (c > maxCount) { regularFont = f; maxCount = c; }
  }

  // Calculate Y-gaps between consecutive lines for paragraph detection
  const lineYs = lines.map(l => l[0].y);
  const yGaps: number[] = [];
  for (let i = 1; i < lineYs.length; i++) {
    yGaps.push(Math.abs(lineYs[i] - lineYs[i - 1]));
  }
  const sortedGaps = [...yGaps].sort((a, b) => a - b);
  const medianGap = sortedGaps.length > 0 ? sortedGaps[Math.floor(sortedGaps.length / 2)] : bodyHeight * 1.2;

  // Find left margin (most common starting X) for indentation-based bullet detection
  const xStartCounts = new Map<number, number>();
  for (const line of lines) {
    const x = Math.round(line[0].x / 5) * 5;
    xStartCounts.set(x, (xStartCounts.get(x) || 0) + 1);
  }
  let leftMargin = 0;
  maxCount = 0;
  for (const [x, c] of xStartCounts) {
    if (c > maxCount) { leftMargin = x; maxCount = c; }
  }

  const bulletChars = new Set(["●", "•", "◆", "■", "▪", "►", "○", "◇", "⬥", "\uf0b7"]);
  const result: string[] = [];
  let lastWasBullet = false;
  let lastBulletX = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineMaxHeight = Math.max(...line.map(it => Math.round(it.height)));

    // Skip page headers/footers in small font
    if (lineMaxHeight <= bodyHeight * 0.8) continue;

    // Skip standalone page numbers
    if (line.length === 1 && line[0].str.trim().length <= 4 && /^\d+$/.test(line[0].str.trim())) continue;

    const isHeading = lineMaxHeight > bodyHeight * 1.2;
    const lineX = Math.round(line[0].x / 5) * 5;
    const isIndented = lineX > leftMargin + 10 && !isHeading;

    // Paragraph break: Y-gap > 1.3× median, or before headings
    if (i > 0 && result.length > 0) {
      const gap = yGaps[i - 1];
      if (gap > medianGap * 1.3 || isHeading) {
        // Don't add blank line between consecutive bullet items
        if (!(lastWasBullet && isIndented)) {
          result.push("");
        }
      }
    }

    // Build line text with inline bold detection
    const parts: string[] = [];
    let inBold = false;
    for (let j = 0; j < line.length; j++) {
      const item = line[j];
      const txt = colorWrap(item);
      const isBoldFont = item.fontName !== undefined
        && item.fontName !== regularFont
        && Math.round(item.height) === bodyHeight;

      if (isBoldFont && !inBold) {
        if (parts.length > 0) parts.push(" ");
        parts.push("**");
        inBold = true;
      } else if (!isBoldFont && inBold) {
        parts.push("** ");
        inBold = false;
      } else if (parts.length > 0) {
        parts.push(" ");
      }
      parts.push(txt);
    }
    if (inBold) parts.push("**");

    let lineText = parts.join("").replace(/  +/g, " ").replace(/\*\* \*\*/g, " ").replace(/\*\*\*\*/g, "").trim();
    if (!lineText) continue;

    // Heading detection
    if (isHeading) {
      lineText = lineText.replace(/\*\*/g, "");
      if (lineMaxHeight > bodyHeight * 1.5) {
        result.push(`## ${lineText}`);
      } else {
        result.push(`### ${lineText}`);
      }
      lastWasBullet = false;
      continue;
    }

    // Bullet list detection — by character OR by indentation
    const firstChar = line[0].str.trim().charAt(0);
    if (bulletChars.has(firstChar)) {
      lineText = lineText.substring(lineText.indexOf(firstChar) + 1).trim();
      result.push(`- ${lineText}`);
      lastWasBullet = true;
      continue;
    }

    if (isIndented) {
      // Check if entire line is bold — it's a sub-heading, not a bullet
      const allBold = line.every(it => it.fontName !== regularFont);
      if (allBold) {
        // Bold indented line = sub-heading paragraph (not bullet)
        result.push("");
        result.push(lineText);
        lastWasBullet = false;
        continue;
      }

      // Continuation: ONLY if deeper indent than bullet start AND previous was bullet
      if (lastWasBullet && lineX > lastBulletX + 5) {
        result.push(`  ${lineText}`);
      } else {
        // New bullet item
        result.push(`- ${lineText}`);
        lastBulletX = lineX;
      }
      lastWasBullet = true;
      continue;
    }

    // Ordered sub-list (A. B. C.)
    const orderedMatch = lineText.match(/^([A-Z])\.\s+(.+)/);
    if (orderedMatch) {
      result.push(`   ${orderedMatch[1]}. ${orderedMatch[2]}`);
      lastWasBullet = true;
      continue;
    }

    lastWasBullet = false;
    result.push(lineText);
  }

  return result.join("\n");
}

/** Strategy 2: gap-based fallback with ratio-based column threshold. */
function gapBasedExtraction(lines: TextItem[][]): string {
  // Collect inter-item gaps across all lines
  const gaps: number[] = [];
  for (const line of lines) {
    for (let i = 1; i < line.length; i++) {
      const gap = line[i].x - (line[i - 1].x + line[i - 1].width);
      if (gap > 0) gaps.push(gap);
    }
  }

  if (!gaps.length) {
    return lines.map(line => line.map(it => colorWrap(it)).join("")).join("\n");
  }

  // Determine column-gap threshold
  gaps.sort((a, b) => a - b);
  const minGap = gaps[0];
  const median = gaps[Math.floor(gaps.length / 2)];

  let colThreshold: number;
  if (minGap > 8) {
    colThreshold = minGap * 0.7;
  } else {
    let ratioIdx = -1;
    for (let i = 1; i < gaps.length; i++) {
      if (gaps[i - 1] >= 1 && gaps[i] >= gaps[i - 1] * 2) {
        ratioIdx = i;
        break;
      }
    }
    colThreshold = ratioIdx > 0
      ? (gaps[ratioIdx - 1] + gaps[ratioIdx]) / 2
      : Math.max(median * 1.5, 10);
  }

  // Split each line into cells based on column gaps
  const rowCells: string[][] = lines.map(line => {
    const cells: string[] = [];
    let parts: string[] = [colorWrap(line[0])];

    for (let i = 1; i < line.length; i++) {
      const gap = line[i].x - (line[i - 1].x + line[i - 1].width);
      if (gap >= colThreshold) {
        cells.push(parts.join("").trim());
        parts = [colorWrap(line[i])];
      } else {
        if (gap > 1) parts.push(" ");
        parts.push(colorWrap(line[i]));
      }
    }
    cells.push(parts.join("").trim());
    return cells.filter(c => c);
  });

  // Detect table: find most common multi-cell count
  const countFreq = new Map<number, number>();
  for (const row of rowCells) {
    if (row.length >= 3) countFreq.set(row.length, (countFreq.get(row.length) || 0) + 1);
  }

  let bestCount = 0, bestFreq = 0;
  for (const [count, freq] of countFreq) {
    if (freq > bestFreq) { bestCount = count; bestFreq = freq; }
  }

  if (bestFreq >= 3 && bestCount >= 3) {
    const preTable: string[] = [];
    const tableRows: string[][] = [];
    const overflow: string[] = [];
    let seenFirstTable = false;

    for (const cells of rowCells) {
      if (cells.length === bestCount) {
        seenFirstTable = true;
        tableRows.push(cells);
      } else if (!seenFirstTable) {
        preTable.push(cells.join("  "));
      } else {
        overflow.push(cells.join("  "));
      }
    }

    if (tableRows.length >= 2) {
      const result: string[] = [...preTable];
      for (let i = 0; i < tableRows.length; i++) {
        const escaped = tableRows[i].map(c => c.replace(/\|/g, "\\|"));
        result.push(`| ${escaped.join(" | ")} |`);
        if (i === 0) {
          result.push(`| ${escaped.map(() => "---").join(" | ")} |`);
        }
      }
      if (overflow.length) {
        result.push("");
        result.push(...overflow);
      }
      return result.join("\n");
    }
  }

  // No table structure — apply markdown formatting (headings, bold, lists, paragraphs)
  const formatted = applyTextFormatting(lines);
  if (formatted.trim()) return formatted;

  // Ultimate fallback: if formatting produced empty, just join raw text
  return lines.map(line => line.map(it => it.str).join(" ")).join("\n");
}

/**
 * Extract outline (bookmarks/TOC) from a PDF document.
 * Returns a flat array with nesting level preserved.
 */
async function extractPdfOutline(doc: any): Promise<PdfOutlineEntry[]> {
  const result: PdfOutlineEntry[] = [];

  let rawOutline: any[] | null;
  try {
    rawOutline = await doc.getOutline();
  } catch (err: any) {
    console.warn("[pdf] failed to get outline:", err.message);
    return result;
  }

  if (!rawOutline || rawOutline.length === 0) return result;

  async function flattenOutline(items: any[], level: number): Promise<void> {
    for (const item of items) {
      try {
        let dest = item.dest;

        // Skip entries without destination
        if (dest == null) continue;

        // Named destination — resolve to array form
        if (typeof dest === "string") {
          dest = await doc.getDestination(dest);
          if (!dest) continue;
        }

        // dest should be an array: [pageRef, ...]
        if (!Array.isArray(dest) || dest.length === 0) continue;

        const pageRef = dest[0];
        if (!pageRef) continue;

        const pageIndex = await doc.getPageIndex(pageRef); // 0-based
        const pageNum = pageIndex + 1; // convert to 1-based

        const title = (item.title || "").trim();
        if (!title) continue;

        result.push({ title, pageNum, level });

        // Recurse into children
        if (item.items && item.items.length > 0) {
          await flattenOutline(item.items, level + 1);
        }
      } catch (err: any) {
        // Some entries might reference external links or invalid pages — skip them
        console.warn(`[pdf] outline entry "${item.title}" — failed to resolve dest:`, err.message);
        // Still recurse into children even if this entry fails
        if (item.items && item.items.length > 0) {
          await flattenOutline(item.items, level + 1);
        }
      }
    }
  }

  await flattenOutline(rawOutline, 0);
  console.log(`[pdf] outline extracted: ${result.length} entries`);
  return result;
}

async function extractPdfContent(buffer: Buffer): Promise<PdfExtractionResult> {
  console.log("[pdf] starting extraction, buffer size:", buffer.length);
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;
  console.log("[pdf] document loaded, pages:", doc.numPages);
  const pages: PdfPage[] = [];
  let outline: PdfOutlineEntry[] = [];

  try {
    for (let i = 1; i <= doc.numPages; i++) {
      // Yield to event loop every 5 pages to keep main process responsive
      if (i > 1 && i % 5 === 0) await new Promise(r => setTimeout(r, 0));

      const page = await doc.getPage(i);

      try {
        // Fetch operator list once (used for both color extraction and image extraction)
        const ops = await page.getOperatorList();

        // Build color map from operator list: position key → "#rrggbb"
        const colorMap = new Map<string, string>();
        let currentColor = "#000000";
        for (let k = 0; k < ops.fnArray.length; k++) {
          if (ops.fnArray[k] === pdfjsLib.OPS.setFillRGBColor) {
            const a = ops.argsArray[k];
            currentColor = "#" + [a[0], a[1], a[2]]
              .map((c: number) => {
                // pdfjs may return 0–1 floats or 0–255 ints depending on color space
                const v = c > 1 ? Math.round(c) : Math.round(c * 255);
                return Math.min(255, Math.max(0, v)).toString(16).padStart(2, "0");
              })
              .join("");
          }
          if (ops.fnArray[k] === pdfjsLib.OPS.moveText) {
            const [x, y] = ops.argsArray[k];
            if (currentColor !== "#000000" && currentColor !== "#ffffff") {
              colorMap.set(Math.round(x * 10) + "," + Math.round(y * 10), currentColor);
            }
          }
        }

        // Extract text with positional data for table detection
        const textContent = await page.getTextContent();
        let text: string;
        try {
          text = extractStructuredText(textContent.items, colorMap);
        } catch (textErr: any) {
          // Per-page fallback: if structured extraction fails, join raw text
          console.error(`[pdf] page ${i} — extractStructuredText FAILED: ${textErr.message}`);
          text = textContent.items
            .filter((it: any) => typeof it.str === "string" && it.str.trim())
            .map((it: any) => it.str)
            .join(" ");
        }
        console.log(`[pdf] page ${i} — text items: ${textContent.items.length}, text length: ${text.length}, colors: ${colorMap.size}`);

        // Extract images
        const images: PdfImage[] = [];
        const seenImgNames = new Set<string>();

        let imgOpsCount = 0;
        for (let k = 0; k < ops.fnArray.length; k++) {
          if (ops.fnArray[k] !== pdfjsLib.OPS.paintImageXObject) continue;
          imgOpsCount++;
          const imgName = ops.argsArray[k][0] as string;
          if (seenImgNames.has(imgName)) continue;
          seenImgNames.add(imgName);

          try {
            // g_ prefix = global/common object, lives in page.commonObjs
            const store = imgName.startsWith("g_") ? page.commonObjs : page.objs;
            const imgObj: any = await new Promise((resolve, reject) => {
              const timer = setTimeout(() => reject(new Error("timeout")), 5000);
              store.get(imgName, (obj: any) => { clearTimeout(timer); resolve(obj); });
            });
            if (!imgObj?.data || !imgObj.width || !imgObj.height) {
              console.log(`[pdf]   image "${imgName}" — no data/dims, skipped`);
              continue;
            }
            const pixels = imgObj.width * imgObj.height;
            if (pixels < MIN_IMG_PIXELS) {
              console.log(`[pdf]   image "${imgName}" — ${imgObj.width}x${imgObj.height} (${pixels}px) too small, skipped`);
              continue;
            }

            const bpp = imgObj.data.length / (imgObj.width * imgObj.height);
            console.log(`[pdf]   image "${imgName}" — ${imgObj.width}x${imgObj.height}, kind=${imgObj.kind}, dataLen=${imgObj.data.length}, bpp=${bpp}`);
            // Determine format from actual data size, not kind (kind can be unreliable)
            const isRGBA = bpp >= 4;
            const dataUri = isRGBA
              ? rgbaToPngDataUri(imgObj.data, imgObj.width, imgObj.height)
              : rgbToPngDataUri(imgObj.data, imgObj.width, imgObj.height);
            console.log(`[pdf]   image "${imgName}" — converted to PNG, dataUri length: ${dataUri.length}`);
            images.push({ dataUri, width: imgObj.width, height: imgObj.height });
          } catch (err: any) {
            console.warn(`[pdf]   image "${imgName}" — error: ${err.message}`);
          }
        }

        console.log(`[pdf] page ${i} — image ops: ${imgOpsCount}, unique: ${seenImgNames.size}, extracted: ${images.length}`);
        pages.push({ pageNum: i, text, images });
      } finally {
        page.cleanup();
      }
    }

    // Extract outline (bookmarks/TOC) before destroying the document
    outline = await extractPdfOutline(doc);

  } finally {
    doc.destroy();
  }

  console.log("[pdf] extraction complete, pages:", pages.length,
    "total images:", pages.reduce((s, p) => s + p.images.length, 0),
    "outline entries:", outline.length);
  return { pages, outline };
}

export function registerIoIpc(): void {
  // Export
  ipcMain.handle("export:markdown", async (_e, token: string) => {
    const project = await getProjectsService().getByToken(token);
    if (!project) throw new Error("Project not found");
    const { sections, export_ } = await getProjectServices(token);
    const allSections = await sections.listAll();
    await export_.exportToMarkdown(allSections, project.path);
  });

  ipcMain.handle("export:markdown-to", async (_e, token: string) => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    if (result.canceled || !result.filePaths.length) return false;
    const { sections, export_ } = await getProjectServices(token);
    const allSections = await sections.listAll();
    await export_.writeToDir(allSections, result.filePaths[0]);
    return true;
  });

  ipcMain.handle("export:pdf", async (_e, token: string, sectionId: string, defaultName: string) => {
    const win = getMainWindow();
    if (!win) return false;

    const safeName = defaultName.replace(/[<>:"/\\|?*]/g, "_");
    const result = await dialog.showSaveDialog(win, {
      title: "Export to PDF",
      defaultPath: `${safeName}.pdf`,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (result.canceled || !result.filePath) return false;

    // Build full markdown (section + all children recursively)
    const { sections } = await getProjectServices(token);
    const markdown = await sections.buildSectionMarkdown(sectionId);

    // Extract TOC from markdown headings
    const tocEntries: { level: number; text: string; id: string }[] = [];
    const lines = markdown.split("\n");
    for (const line of lines) {
      const m = line.match(/^(#{1,6})\s+(.+)$/);
      if (!m) continue;
      const level = m[1].length;
      const text = m[2].replace(/\*\*|__|\*|_|`/g, "").trim();
      const id = "h-" + text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
      tocEntries.push({ level, text, id });
    }

    // Build TOC HTML
    let tocHtml = "";
    if (tocEntries.length > 1) {
      const minLevel = Math.min(...tocEntries.map(e => e.level));
      tocHtml = `<nav class="toc"><h2 class="toc-title">Содержание</h2><ul>`;
      for (const entry of tocEntries) {
        const indent = entry.level - minLevel;
        tocHtml += `<li style="margin-left:${indent * 20}px"><a href="#${entry.id}">${entry.text}</a></li>`;
      }
      tocHtml += `</ul></nav>`;
    }

    // Convert markdown → HTML, injecting ids into headings
    const { Marked } = await import("marked");
    const headingIndex = { i: 0 };
    const md = new Marked();
    md.use({
      renderer: {
        heading({ text, depth }: { text: string; depth: number }) {
          const entry = tocEntries[headingIndex.i++];
          const id = entry ? entry.id : "";
          return `<h${depth} id="${id}">${text}</h${depth}>\n`;
        },
      },
    });
    const bodyHtml = await md.parse(markdown, { gfm: true, breaks: false });

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  body { font-family: "Segoe UI", system-ui, -apple-system, sans-serif; color: #1a1a18;
         max-width: 720px; margin: 0 auto; padding: 40px 32px; line-height: 1.7; font-size: 15px; }
  h1, h2, h3, h4, h5, h6 { break-after: avoid; page-break-after: avoid; }
  h1 { font-size: 28px; font-weight: 700; margin: 32px 0 8px; line-height: 1.25; }
  h2 { font-size: 22px; font-weight: 600; margin: 28px 0 6px; break-before: page; page-break-before: always; }
  h3 { font-size: 17px; font-weight: 600; margin: 22px 0 4px; }
  h4, h5, h6 { font-size: 15px; font-weight: 600; margin: 18px 0 4px; }
  h2:first-child, body > h2:first-of-type { break-before: avoid; page-break-before: avoid; }
  p { margin: 0 0 12px; }
  a { color: #0D7C66; text-decoration: none; }
  strong { font-weight: 600; }
  code { background: #f3f1ed; padding: 2px 5px; border-radius: 3px; font-family: "JetBrains Mono", "Consolas", monospace; font-size: 13px; }
  pre { background: #f3f1ed; padding: 16px 18px; border-radius: 8px; overflow-x: auto; margin: 12px 0; }
  pre code { background: none; padding: 0; font-size: 13px; }
  blockquote { border-left: 3px solid #0D7C66; margin: 12px 0; padding: 4px 16px; color: #555; }
  ul, ol { padding-left: 24px; margin: 8px 0; }
  li { margin: 4px 0; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; }
  th, td { border: 1px solid #ddd; padding: 8px 12px; text-align: left; }
  th { background: #f5f5f5; font-weight: 600; text-transform: uppercase; font-size: 12px; }
  hr { border: none; border-top: 1px solid #ddd; margin: 24px 0; }
  img { max-width: 100%; height: auto; }
  .toc { break-after: page; page-break-after: always; }
  .toc-title { font-size: 22px; font-weight: 600; margin: 0 0 16px; }
  .toc ul { list-style: none; padding: 0; }
  .toc li { padding: 4px 0; font-size: 14px; line-height: 1.6; }
  .toc a { color: #1a1a18; border-bottom: 1px dotted #ccc; }
</style></head><body>${tocHtml}${bodyHtml}</body></html>`;

    // Render in hidden window and print to PDF
    const { BrowserWindow: BW } = await import("electron");
    const printWin = new BW({ show: false, width: 800, height: 600, webPreferences: { offscreen: true } });
    try {
      await printWin.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html));
      const pdf = await printWin.webContents.printToPDF({
        printBackground: true,
        margins: { marginType: "default" },
      });
      const { writeFileSync } = await import("fs");
      writeFileSync(result.filePath, pdf);
      return true;
    } finally {
      printWin.destroy();
    }
  });

  // Import markdown
  ipcMain.handle("import:markdown", async (_e, token: string, folderId: string) => {
    const result = await dialog.showOpenDialog(getMainWindow()!, {
      title: "Import Markdown",
      filters: [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }],
      properties: ["openFile", "multiSelections"],
    });
    if (result.canceled || !result.filePaths.length) return [];
    suppressExternalChange(token);
    const { import_, index } = await getProjectServices(token);
    const fileIds: string[] = [];
    for (const filePath of result.filePaths) {
      const content = readFileSync(filePath, "utf-8");
      const fileName = basename(filePath, extname(filePath));
      const fileId = await import_.importMarkdown(folderId, fileName, content);
      fileIds.push(fileId);
    }
    trackBgTask("Индексация поиска", () => index.reindexAll()).catch(err => console.warn("[index] reindex after markdown import:", err));
    return fileIds;
  });

  // Image picker
  ipcMain.handle("dialog:pickImage", async () => {
    const result = await dialog.showOpenDialog(getMainWindow()!, {
      title: "Выберите изображение",
      filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"] }],
      properties: ["openFile"],
    });
    if (result.canceled || !result.filePaths.length) return null;
    const filePath = result.filePaths[0];
    const ext = extname(filePath).slice(1).toLowerCase();
    const mime = ext === "svg" ? "image/svg+xml" : ext === "jpg" ? "image/jpeg" : `image/${ext}`;
    const base64 = readFileSync(filePath).toString("base64");
    return `data:${mime};base64,${base64}`;
  });

  // Import PDF
  ipcMain.handle("import:pdf", async (_e, token: string, folderId: string) => {
    const result = await dialog.showOpenDialog(getMainWindow()!, {
      title: "Import PDF",
      filters: [{ name: "PDF", extensions: ["pdf"] }],
      properties: ["openFile"],
    });
    if (result.canceled || !result.filePaths.length) return null;
    const filePath = result.filePaths[0];
    const fileName = basename(filePath, extname(filePath));

    return trackBgTask(`Импорт PDF: ${basename(filePath)}`, async () => {
      console.log("[pdf] importing file:", filePath);
      const buffer = readFileSync(filePath);
      console.log("[pdf] file read, size:", buffer.length);
      const { pages, outline } = await extractPdfContent(buffer);
      const hasContent = pages.some(p => p.text.trim() || p.images.length > 0);
      console.log("[pdf] hasContent:", hasContent, "outline entries:", outline.length);
      if (!hasContent) {
        throw new Error("PDF не содержит извлекаемого контента (ни текста, ни изображений).");
      }
      suppressExternalChange(token);
      const { import_, index } = await getProjectServices(token);
      console.log("[pdf] calling importPdfContent...");
      const fileId = await import_.importPdfContent(folderId, fileName, pages, outline);
      console.log("[pdf] import done, fileId:", fileId);
      trackBgTask("Индексация поиска", () => index.reindexAll()).catch(err => console.warn("[index] reindex after pdf import:", err));
      return fileId;
    });
  });

  // Import markdown from file paths (drag-and-drop)
  ipcMain.handle("import:markdown-files", async (_e, token: string, folderId: string, filePaths: string[]) => {
    suppressExternalChange(token);
    const { import_, index } = await getProjectServices(token);
    const fileIds: string[] = [];
    for (const filePath of filePaths) {
      const content = readFileSync(filePath, "utf-8");
      const fileName = basename(filePath, extname(filePath));
      const fileId = await import_.importMarkdown(folderId, fileName, content);
      fileIds.push(fileId);
    }
    trackBgTask("Индексация поиска", () => index.reindexAll()).catch(err => console.warn("[index] reindex after markdown drop:", err));
    return fileIds;
  });

  // Import PDF from file path (drag-and-drop)
  ipcMain.handle("import:pdf-file", async (_e, token: string, folderId: string, filePath: string) => {
    return trackBgTask(`Импорт PDF: ${basename(filePath)}`, async () => {
      const buffer = readFileSync(filePath);
      const { pages, outline } = await extractPdfContent(buffer);
      const hasContent = pages.some(p => p.text.trim() || p.images.length > 0);
      if (!hasContent) {
        throw new Error("PDF не содержит извлекаемого контента (ни текста, ни изображений).");
      }
      const fileName = basename(filePath, extname(filePath));
      suppressExternalChange(token);
      const { import_, index } = await getProjectServices(token);
      const fileId = await import_.importPdfContent(folderId, fileName, pages, outline);
      trackBgTask("Индексация поиска", () => index.reindexAll()).catch(err => console.warn("[index] reindex after pdf drop:", err));
      return fileId;
    });
  });
}
