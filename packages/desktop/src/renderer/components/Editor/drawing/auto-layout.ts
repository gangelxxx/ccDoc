import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";
import type { DrawElement, DrawState } from "../drawing-engine.js";
import {
  getBindingPoint, computeAnchor, updateBindings,
} from "../drawing-engine.js";
import type { HistoryStack } from "../drawing-engine.js";

export async function autoLayoutWithElk(
  stateRef: React.RefObject<DrawState>,
  historyRef: React.RefObject<HistoryStack>,
  scheduleSave: () => void,
  redraw: () => void,
  forceRender: React.Dispatch<React.SetStateAction<number>>,
) {
  const els = stateRef.current!.elements.filter((e) => !e.isDeleted);
  const shapes = els.filter((e) => ["rectangle", "ellipse", "diamond"].includes(e.type));
  const arrows = els.filter((e) => (e.type === "arrow" || e.type === "line") && e.startBinding && e.endBinding);
  if (shapes.length === 0) return;

  // Save undo snapshot
  historyRef.current!.push(stateRef.current!.elements);

  const elkChildren: ElkNode[] = shapes.map((s) => ({
    id: s.id,
    width: Math.abs(s.width) || 150,
    height: Math.abs(s.height) || 80,
  }));

  const shapeIds = new Set(shapes.map((s) => s.id));
  const validArrows = arrows.filter((a) => shapeIds.has(a.startBinding!.elementId) && shapeIds.has(a.endBinding!.elementId));
  // Map arrow index to ELK edge id
  const arrowToEdgeId = new Map<number, string>();
  const elkEdges = validArrows.map((a, i) => {
    const edgeId = `ea${i}`;
    arrowToEdgeId.set(i, edgeId);
    const edge: any = {
      id: edgeId,
      sources: [a.startBinding!.elementId],
      targets: [a.endBinding!.elementId],
    };
    // Add edge label so ELK reserves space for the bound text box
    if (a.boundText) {
      const fontSize = a.boundTextFontSize ?? 14;
      const charW = fontSize * 0.6;
      const textLines = a.boundText.split('\n');
      const maxLineW = Math.max(...textLines.map((l: string) => l.length * charW), 20);
      const padX = 8, padY = 4;
      edge.labels = [{
        id: `${edgeId}-label`,
        text: a.boundText,
        width: maxLineW + padX * 2,
        height: textLines.length * fontSize * 1.3 + padY * 2,
        layoutOptions: { "org.eclipse.elk.edgeLabels.placement": "CENTER" },
      }];
    }
    return edge;
  });

  const elk = new ELK();
  const graph = await elk.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.spacing.nodeNode": "60",
      "elk.layered.spacing.nodeNodeBetweenLayers": "100",
      "elk.padding": "[top=40,left=40,bottom=40,right=40]",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      "elk.edgeLabels.placement": "CENTER",
    },
    children: elkChildren,
    edges: elkEdges,
  });

  // Build map of ELK edge routes
  const edgeRoutes = new Map<string, { start: { x: number; y: number }; end: { x: number; y: number }; bends: { x: number; y: number }[] }>();
  for (const edge of graph.edges ?? []) {
    const sections = (edge as any).sections;
    if (sections && sections.length > 0) {
      const sec = sections[0];
      edgeRoutes.set(edge.id, {
        start: sec.startPoint,
        end: sec.endPoint,
        bends: sec.bendPoints ?? [],
      });
    }
  }

  // Build map of new positions
  const posMap = new Map<string, { x: number; y: number; w: number; h: number }>();
  for (const node of graph.children ?? []) {
    if (node.x != null && node.y != null) {
      posMap.set(node.id, { x: Math.round(node.x), y: Math.round(node.y), w: node.width!, h: node.height! });
    }
  }

  // Move shapes to new positions
  for (const el of stateRef.current!.elements) {
    const pos = posMap.get(el.id);
    if (pos) {
      el.x = pos.x;
      el.y = pos.y;
    }
  }

  // Apply ELK edge routes to arrows
  const byId = new Map<string, DrawElement>();
  for (const el of stateRef.current!.elements) {
    if (!el.isDeleted) byId.set(el.id, el);
  }

  for (let i = 0; i < validArrows.length; i++) {
    const arrow = validArrows[i];
    const edgeId = arrowToEdgeId.get(i)!;
    const route = edgeRoutes.get(edgeId);
    const src = byId.get(arrow.startBinding!.elementId);
    const tgt = byId.get(arrow.endBinding!.elementId);
    if (!src || !tgt) continue;

    if (route) {
      // Use ELK route: start -> bends -> end
      const allPts: { x: number; y: number }[] = [route.start, ...route.bends, route.end];

      // Snap start/end to actual shape boundary only for non-rectangular shapes
      // (ELK already computes correct points for rectangles)
      const needsSnapStart = src.type === 'diamond' || src.type === 'ellipse';
      const needsSnapEnd = tgt.type === 'diamond' || tgt.type === 'ellipse';
      if (needsSnapStart) {
        const dir = allPts.length > 1 ? allPts[1] : allPts[0];
        const [bx, by] = getBindingPoint(src, dir.x, dir.y);
        // Keep the orthogonal axis from ELK, only move along the connection direction
        const elkStart = allPts[0];
        if (Math.abs(elkStart.x - dir.x) < 2) {
          // Vertical segment -- keep X from ELK, snap Y
          allPts[0] = { x: elkStart.x, y: by };
        } else if (Math.abs(elkStart.y - dir.y) < 2) {
          // Horizontal segment -- keep Y from ELK, snap X
          allPts[0] = { x: bx, y: elkStart.y };
        } else {
          allPts[0] = { x: bx, y: by };
        }
      }
      if (needsSnapEnd) {
        const dir = allPts.length > 1 ? allPts[allPts.length - 2] : allPts[allPts.length - 1];
        const [bx, by] = getBindingPoint(tgt, dir.x, dir.y);
        const elkEnd = allPts[allPts.length - 1];
        if (Math.abs(elkEnd.x - dir.x) < 2) {
          allPts[allPts.length - 1] = { x: elkEnd.x, y: by };
        } else if (Math.abs(elkEnd.y - dir.y) < 2) {
          allPts[allPts.length - 1] = { x: bx, y: elkEnd.y };
        } else {
          allPts[allPts.length - 1] = { x: bx, y: by };
        }
      }

      const baseX = allPts[0].x;
      const baseY = allPts[0].y;
      arrow.x = Math.round(baseX);
      arrow.y = Math.round(baseY);
      arrow.points = allPts.map((p) => [Math.round(p.x - baseX), Math.round(p.y - baseY)] as [number, number]);
      const last = arrow.points[arrow.points.length - 1];
      arrow.width = last[0];
      arrow.height = last[1];

      // Update anchors based on final (straightened) points
      const finalStart = allPts[0], finalEnd = allPts[allPts.length - 1];
      arrow.startBinding = {
        elementId: src.id,
        anchorX: computeAnchor(src, finalStart.x, finalStart.y)[0],
        anchorY: computeAnchor(src, finalStart.x, finalStart.y)[1],
      };
      arrow.endBinding = {
        elementId: tgt.id,
        anchorX: computeAnchor(tgt, finalEnd.x, finalEnd.y)[0],
        anchorY: computeAnchor(tgt, finalEnd.x, finalEnd.y)[1],
      };
    } else {
      // Fallback: snap to shape boundary
      const srcCx = src.x + Math.abs(src.width) / 2;
      const srcCy = src.y + Math.abs(src.height) / 2;
      const tgtCx = tgt.x + Math.abs(tgt.width) / 2;
      const tgtCy = tgt.y + Math.abs(tgt.height) / 2;
      const [startBx, startBy] = getBindingPoint(src, tgtCx, tgtCy);
      const [endBx, endBy] = getBindingPoint(tgt, srcCx, srcCy);
      arrow.startBinding = { elementId: src.id, anchorX: computeAnchor(src, startBx, startBy)[0], anchorY: computeAnchor(src, startBx, startBy)[1] };
      arrow.endBinding = { elementId: tgt.id, anchorX: computeAnchor(tgt, endBx, endBy)[0], anchorY: computeAnchor(tgt, endBx, endBy)[1] };
    }

    // Force sharp (straight segments) for orthogonal routing
    arrow.arrowType = "sharp" as any;
    // Reset bezier handles
    arrow.handles = undefined;
  }

  // Update binding positions for arrows without ELK routes
  updateBindings(stateRef.current!.elements);

  scheduleSave();
  redraw();
  forceRender((n) => n + 1);
}
