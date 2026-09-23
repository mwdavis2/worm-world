import {
  type Node,
  type Edge,
  Position,
  getBezierPath,
  getStraightPath,
} from 'reactflow';
import { NodeType, Sex } from 'models/enums';
import { type Strain } from 'models/frontend/Strain/Strain';
import { type AllelePair } from 'models/frontend/AllelePair/AllelePair';
import {
  STRAIN_NODE_WIDTH,
  STRAIN_NODE_HEIGHT,
} from 'components/StrainNode/StrainNode';
import { type EdgeStyle } from 'utils/preferences';
import { sampleThemeColors, type ThemeColors } from './theme';
import { createTextRenderer, type TextRenderer } from './textToPath';
import {
  MALE_ICON,
  HERM_ICON,
  SELF_ICON,
  X_ICON,
  type IconSpec,
} from './icons';

const MIDDLE_NODE_SIZE = 64;
const NOTE_NODE_WIDTH = 320;
const NOTE_NODE_HEIGHT = 112;
const EXPORT_PADDING = 50;

const CHROM_LABEL_SIZE = 16;
const ALLELE_TEXT_SIZE = 16;
const NAME_TEXT_SIZE = 14;
const PROB_TEXT_SIZE = 10;
const ICON_SIZE = 16;
const COLUMN_GAP = 8; // approximates the card's mx-2 spacing

interface Size {
  width: number;
  height: number;
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const nodeSize = (node: Node): Size => {
  switch (node.type) {
    case NodeType.Strain:
      return { width: STRAIN_NODE_WIDTH, height: STRAIN_NODE_HEIGHT };
    case NodeType.Self:
    case NodeType.X:
      return { width: MIDDLE_NODE_SIZE, height: MIDDLE_NODE_SIZE };
    case NodeType.Note:
      return { width: NOTE_NODE_WIDTH, height: NOTE_NODE_HEIGHT };
    default:
      return { width: 0, height: 0 };
  }
};

// A node with a parentNode stores `position` RELATIVE to that parent (a real
// react-flow sub-flow/nesting feature this app relies on for self-cross/
// mated-cross children, so a middle node's children move together when the
// middle node itself moves) - not always an absolute canvas coordinate.
// Confirmed directly against a real saved design: a self-cross's children
// were stored at things like {x: -680, y: 100}, which only makes sense
// relative to their Self node's own position, itself relative to ITS
// parent strain. Walk the chain and sum offsets to get the true canvas
// position; guard against a corrupt/cyclic parentNode chain.
const resolveAbsolutePosition = (
  node: Node,
  nodeById: Map<string, Node>
): { x: number; y: number } => {
  let x = node.position.x;
  let y = node.position.y;
  let current = node;
  const visited = new Set<string>([node.id]);
  while (current.parentNode !== undefined) {
    const parent = nodeById.get(current.parentNode);
    if (parent === undefined || visited.has(parent.id)) break;
    x += parent.position.x;
    y += parent.position.y;
    visited.add(parent.id);
    current = parent;
  }
  return { x, y };
};

const isExportable = (node: Node): boolean =>
  !(node.hidden ?? false) &&
  (node.type === NodeType.Strain ||
    node.type === NodeType.Self ||
    node.type === NodeType.X ||
    node.type === NodeType.Note);

// Centers `text` horizontally at `centerX`, baseline at `baselineY`.
const centeredGlyphMarkup = (
  tr: TextRenderer,
  text: string,
  centerX: number,
  baselineY: number,
  size: number,
  weight: 'normal' | 'bold',
  color: string
): string => {
  const width = tr.measureWidth(text, size, weight);
  return tr.glyphMarkup(
    text,
    centerX - width / 2,
    baselineY,
    size,
    weight,
    color
  );
};

const iconMarkup = (
  icon: IconSpec,
  x: number,
  y: number,
  size: number,
  color: string
): string => {
  const scale = size / icon.viewBoxSize;
  const transform = `translate(${x}, ${y}) scale(${scale})`;
  if (icon.stroke === true) {
    return `<path d="${icon.d}" transform="${transform}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />`;
  }
  return `<path d="${icon.d}" transform="${transform}" fill="${color}" />`;
};

interface MeasuredColumn {
  width: number;
  isEca: boolean;
  ecaLabel?: string; // set (and non-empty) only for a non-wild Eca pair
  topName?: string;
  botName?: string;
}

const measureAlleleColumn = (
  pair: AllelePair,
  showGenes: boolean,
  isMaleX: boolean,
  tr: TextRenderer
): MeasuredColumn => {
  if (pair.isEca()) {
    if (pair.isWild()) return { width: 0, isEca: true };
    const label = pair.top.name;
    const width = tr.measureWidth(label, ALLELE_TEXT_SIZE, 'normal');
    return { width, isEca: true, ecaLabel: label };
  }
  const topName = showGenes ? pair.top.getQualifiedName() : pair.top.name;
  const botName = isMaleX
    ? '0'
    : showGenes
    ? pair.bot.getQualifiedName()
    : pair.bot.name;
  const topWidth = tr.measureWidth(topName, ALLELE_TEXT_SIZE, 'normal');
  const botWidth = tr.measureWidth(botName, ALLELE_TEXT_SIZE, 'normal');
  return {
    width: Math.max(topWidth, botWidth),
    isEca: false,
    topName,
    botName,
  };
};

const renderStrainCard = (
  node: Node<Strain>,
  position: { x: number; y: number },
  colors: ThemeColors,
  tr: TextRenderer,
  showGenes: boolean
): string => {
  const strain = node.data;
  const { x, y } = position;
  const centerX = x + STRAIN_NODE_WIDTH / 2;
  const contentTop = y + 24;
  const parts: string[] = [];

  parts.push(
    `<rect x="${x}" y="${y}" width="${STRAIN_NODE_WIDTH}" height="${STRAIN_NODE_HEIGHT}" rx="4" fill="${colors.cardBackground}" />`
  );

  const sexIcon = strain.sex === Sex.Male ? MALE_ICON : HERM_ICON;
  const iconOpacity = strain.isParent ? 0.5 : 1;
  parts.push(
    `<g opacity="${iconOpacity}">${iconMarkup(
      sexIcon,
      x + 8,
      y + 4,
      ICON_SIZE,
      colors.contentText
    )}</g>`
  );

  if (strain.isChild) {
    const probText = `${(strain.probability * 100).toFixed(2)}%`;
    parts.push(
      centeredGlyphMarkup(
        tr,
        probText,
        centerX,
        y + 17,
        PROB_TEXT_SIZE,
        'normal',
        colors.probabilityText
      )
    );
  }

  if (strain.isEmptyWild()) {
    parts.push(
      centeredGlyphMarkup(
        tr,
        '(Wild)',
        centerX,
        contentTop + 56,
        ALLELE_TEXT_SIZE,
        'normal',
        colors.contentText
      )
    );
  } else {
    const chromPairs = strain
      .getSortedChromPairs()
      .filter((cp) => !(cp.isEca() && cp.isWild()));
    const measured = chromPairs.map((cp) => {
      const name = cp.getChromName() ?? '?';
      const isMaleX = strain.sex === Sex.Male && cp.isX();
      const cols = cp.allelePairs.map((ap) =>
        measureAlleleColumn(ap, showGenes, isMaleX, tr)
      );
      const colsWidth =
        cols.reduce((sum, c) => sum + c.width + COLUMN_GAP, 0) - COLUMN_GAP;
      const nameWidth = tr.measureWidth(name, CHROM_LABEL_SIZE, 'bold');
      const boxWidth = Math.max(nameWidth, colsWidth) + 16;
      return { name, cols, boxWidth };
    });
    const semicolonWidth = tr.measureWidth(';', ALLELE_TEXT_SIZE, 'normal');
    const totalWidth = measured.reduce(
      (sum, m, i) =>
        sum + m.boxWidth + (i < measured.length - 1 ? semicolonWidth + 4 : 0),
      0
    );

    // Mirrors the live app's useFitScale: the card is a fixed size, so wide
    // genotypes (many chromosome columns / long allele names) get the whole
    // content block shrunk to fit rather than overflowing into neighboring
    // cards. Scaled around the content's own top-left, matching
    // StrainCard.tsx's transformOrigin: 'top left'.
    const contentScale =
      totalWidth > 0 ? Math.min(1, STRAIN_NODE_WIDTH / totalWidth) : 1;
    const contentParts: string[] = [];

    let cursorX = centerX - totalWidth / 2;
    measured.forEach((m, i) => {
      const boxCenterX = cursorX + m.boxWidth / 2;
      contentParts.push(
        centeredGlyphMarkup(
          tr,
          m.name,
          boxCenterX,
          contentTop + 16,
          CHROM_LABEL_SIZE,
          'bold',
          colors.contentText
        )
      );

      const colsWidth =
        m.cols.reduce((sum, c) => sum + c.width + COLUMN_GAP, 0) - COLUMN_GAP;
      let colX = boxCenterX - colsWidth / 2;
      m.cols.forEach((c) => {
        if (c.isEca) {
          if (c.ecaLabel !== undefined) {
            contentParts.push(
              centeredGlyphMarkup(
                tr,
                c.ecaLabel,
                colX + c.width / 2,
                contentTop + 56,
                ALLELE_TEXT_SIZE,
                'normal',
                colors.contentText
              )
            );
          }
        } else {
          const columnCenterX = colX + c.width / 2;
          contentParts.push(
            centeredGlyphMarkup(
              tr,
              c.topName ?? '',
              columnCenterX,
              contentTop + 40,
              ALLELE_TEXT_SIZE,
              'normal',
              colors.contentText
            )
          );
          contentParts.push(
            `<line x1="${colX}" y1="${contentTop + 50}" x2="${
              colX + c.width
            }" y2="${contentTop + 50}" stroke="${
              colors.contentText
            }" stroke-width="1" />`
          );
          contentParts.push(
            centeredGlyphMarkup(
              tr,
              c.botName ?? '',
              columnCenterX,
              contentTop + 70,
              ALLELE_TEXT_SIZE,
              'normal',
              colors.contentText
            )
          );
        }
        colX += c.width + COLUMN_GAP;
      });

      cursorX += m.boxWidth;
      if (i < measured.length - 1) {
        contentParts.push(
          tr.glyphMarkup(
            ';',
            cursorX + 2,
            contentTop + 56,
            ALLELE_TEXT_SIZE,
            'normal',
            colors.contentText
          )
        );
        cursorX += semicolonWidth + 4;
      }
    });

    // Anchor the shrink-to-fit scale on the card's own center, not the
    // unscaled content's left edge - anchoring on the content's left edge
    // drifts further left the wider (and more-shrunk) the genotype is,
    // pulling the whole block off-center to the left instead of keeping it
    // centered in the card.
    const originX = centerX;
    const originY = contentTop;
    parts.push(
      `<g transform="translate(${originX}, ${originY}) scale(${contentScale}) translate(${-originX}, ${-originY})">${contentParts.join(
        ''
      )}</g>`
    );
  }

  if (strain.name !== '') {
    parts.push(
      centeredGlyphMarkup(
        tr,
        strain.name,
        centerX,
        y + STRAIN_NODE_HEIGHT - 8,
        NAME_TEXT_SIZE,
        'bold',
        colors.contentText
      )
    );
  }

  return parts.join('');
};

const renderMiddleNode = (
  node: Node,
  position: { x: number; y: number },
  colors: ThemeColors
): string => {
  const { x, y } = position;
  const isSelf = node.type === NodeType.Self;
  const background = isSelf
    ? colors.selfNodeBackground
    : colors.xNodeBackground;
  const icon = isSelf ? SELF_ICON : X_ICON;
  const cx = x + MIDDLE_NODE_SIZE / 2;
  const cy = y + MIDDLE_NODE_SIZE / 2;
  const iconSize = 32;
  return (
    `<circle cx="${cx}" cy="${cy}" r="${
      MIDDLE_NODE_SIZE / 2
    }" fill="${background}" />` +
    iconMarkup(
      icon,
      cx - iconSize / 2,
      cy - iconSize / 2,
      iconSize,
      colors.middleNodeIcon
    )
  );
};

const wrapText = (
  text: string,
  maxWidth: number,
  fontSize: number,
  tr: TextRenderer
): string[] => {
  const words = text.split(/\s+/).filter((word) => word.length > 0);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`;
    const width = tr.measureWidth(candidate, fontSize, 'normal');
    if (width > maxWidth && current !== '') {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current !== '') lines.push(current);
  return lines;
};

// Deliberately simplified - just a rectangle with wrapped text, not a
// reproduction of NoteNode's real on-screen styling (per explicit scope
// decision).
const renderNoteNode = (
  node: Node<string>,
  position: { x: number; y: number },
  colors: ThemeColors,
  tr: TextRenderer
): string => {
  const { x, y } = position;
  const fontSize = 14;
  const lineHeight = 18;
  const parts = [
    `<rect x="${x}" y="${y}" width="${NOTE_NODE_WIDTH}" height="${NOTE_NODE_HEIGHT}" rx="4" fill="${colors.cardBackground}" stroke="${colors.contentText}" stroke-width="1" />`,
  ];
  const maxLines = Math.floor((NOTE_NODE_HEIGHT - 16) / lineHeight);
  const lines = wrapText(node.data, NOTE_NODE_WIDTH - 16, fontSize, tr).slice(
    0,
    maxLines
  );
  lines.forEach((line, i) => {
    parts.push(
      tr.glyphMarkup(
        line,
        x + 8,
        y + 8 + (i + 1) * lineHeight,
        fontSize,
        'normal',
        colors.contentText
      )
    );
  });
  return parts.join('');
};

const handleOffset = (
  size: Size,
  position: Position
): { x: number; y: number } => {
  switch (position) {
    case Position.Top:
      return { x: size.width / 2, y: 0 };
    case Position.Bottom:
      return { x: size.width / 2, y: size.height };
    case Position.Left:
      return { x: 0, y: size.height / 2 };
    case Position.Right:
      return { x: size.width, y: size.height / 2 };
  }
};

const renderEdge = (
  edge: Edge,
  nodeById: Map<string, Node>,
  absolutePositionById: Map<string, { x: number; y: number }>,
  edgeStyle: EdgeStyle,
  colors: ThemeColors
): string => {
  const sourceNode = nodeById.get(edge.source);
  const targetNode = nodeById.get(edge.target);
  if (sourceNode === undefined || targetNode === undefined) return '';
  if ((sourceNode.hidden ?? false) || (targetNode.hidden ?? false)) return '';

  const sourcePos = absolutePositionById.get(edge.source);
  const targetPos = absolutePositionById.get(edge.target);
  if (sourcePos === undefined || targetPos === undefined) return '';

  // Every handle in this app is dead-center on its side of a fixed-size box
  // (StrainNode.tsx/MiddleNode.tsx), so handle coordinates are derived
  // purely from node position + size - no DOM measurement needed. Child
  // edges never specify a handle explicitly (their only possible handle is
  // the source's 'bottom'/target's 'top'), so those are the defaults.
  const sourcePosition = (edge.sourceHandle ?? 'bottom') as Position;
  const targetPosition = (edge.targetHandle ?? 'top') as Position;
  const sourceOffset = handleOffset(nodeSize(sourceNode), sourcePosition);
  const targetOffset = handleOffset(nodeSize(targetNode), targetPosition);
  const sourceX = sourcePos.x + sourceOffset.x;
  const sourceY = sourcePos.y + sourceOffset.y;
  const targetX = targetPos.x + targetOffset.x;
  const targetY = targetPos.y + targetOffset.y;

  const [d] =
    edgeStyle === 'straight'
      ? getStraightPath({ sourceX, sourceY, targetX, targetY })
      : getBezierPath({
          sourceX,
          sourceY,
          sourcePosition,
          targetX,
          targetY,
          targetPosition,
        });

  return `<path d="${d}" fill="none" stroke="${colors.edgeStroke}" stroke-opacity="${colors.edgeStrokeOpacity}" stroke-width="2" />`;
};

export const buildCrossDesignSvg = async (
  allNodes: Node[],
  edges: Edge[],
  edgeStyle: EdgeStyle,
  showGenes: boolean
): Promise<string> => {
  // Defensive: a saved CrossDesign's node array can end up with duplicate
  // entries sharing the same id (seen directly in real, exported app data -
  // one node duplicated 15x). react-flow's own React-key-based rendering
  // silently collapses these to one on-screen, but iterating the raw array
  // ourselves would otherwise redraw the same card stacked on itself
  // repeatedly. Keep only the last entry per id, matching how a later
  // array entry would win in react-flow's own reconciliation.
  const nodeById = new Map(allNodes.map((node) => [node.id, node]));
  const nodes = [...nodeById.values()];
  const exportableNodes = nodes.filter(isExportable);
  const absolutePositionById = new Map(
    nodes.map((node) => [node.id, resolveAbsolutePosition(node, nodeById)])
  );

  const bounds = exportableNodes.reduce<Bounds>(
    (acc, node) => {
      const size = nodeSize(node);
      const position = absolutePositionById.get(node.id) ?? node.position;
      return {
        minX: Math.min(acc.minX, position.x),
        minY: Math.min(acc.minY, position.y),
        maxX: Math.max(acc.maxX, position.x + size.width),
        maxY: Math.max(acc.maxY, position.y + size.height),
      };
    },
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  );
  const hasContent = Number.isFinite(bounds.minX);
  const minX = (hasContent ? bounds.minX : 0) - EXPORT_PADDING;
  const minY = (hasContent ? bounds.minY : 0) - EXPORT_PADDING;
  const width =
    (hasContent ? bounds.maxX - bounds.minX : 0) + EXPORT_PADDING * 2;
  const height =
    (hasContent ? bounds.maxY - bounds.minY : 0) + EXPORT_PADDING * 2;

  const colors = sampleThemeColors();
  const textRenderer = await createTextRenderer();

  const edgeMarkup = edges
    .filter((edge) => !(edge.hidden ?? false))
    .map((edge) =>
      renderEdge(edge, nodeById, absolutePositionById, edgeStyle, colors)
    )
    .join('');

  const nodeMarkup = exportableNodes
    .map((node) => {
      const position = absolutePositionById.get(node.id) ?? node.position;
      if (node.type === NodeType.Strain)
        return renderStrainCard(
          node as Node<Strain>,
          position,
          colors,
          textRenderer,
          showGenes
        );
      if (node.type === NodeType.Self || node.type === NodeType.X)
        return renderMiddleNode(node, position, colors);
      if (node.type === NodeType.Note)
        return renderNoteNode(
          node as Node<string>,
          position,
          colors,
          textRenderer
        );
      return '';
    })
    .join('');

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${width} ${height}" width="${width}" height="${height}">` +
    `<rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="${colors.canvasBackground}" />` +
    edgeMarkup +
    nodeMarkup +
    `</svg>`
  );
};
