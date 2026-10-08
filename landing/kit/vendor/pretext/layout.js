// Prepare text with Intl segmentation and cached Canvas measurements, then
// lay it out with arithmetic. Emoji calibration may perform a cached DOM read
// during preparation; layout itself does no measurement or string work.
// Rich APIs add source cursors, text materialization and approximate bidi metadata.
// Browser measurement limitations are documented in README.md and PLATFORM_BUGS.md.
// Based on Sebastian Markbage's text-layout research (github.com/chenglou/text-layout).
import { computeSegmentLevels } from './bidi.js';
import { analyzeText, clearAnalysisCaches, getBreakablePreferredBreaks, getCjkTextUnits, getSharedGraphemeSegmenter, isCJK, isNumericRunSegment, isIndependentSymbolRun, setAnalysisLocale, } from './analysis.js';
import { clearMeasurementCaches, getCorrectedSegmentWidth, getSegmentBreakableFitAdvances, getEngineProfile, getFontMeasurementState, getSegmentMetrics, textMayContainEmoji, } from './measurement.js';
import { countPreparedLines, measurePreparedLineGeometry, normalizePreparedLineStart, stepPreparedLineGeometryFromChunk, walkPreparedLinesRaw, } from './line-break.js';
import { buildLineTextFromRange, clearLineTextCaches, getLineTextCache, } from './line-text.js';
// --- Public API ---
function createEmptyPrepared(includeSegments) {
    if (includeSegments) {
        return {
            widths: [],
            lineEndFitAdvances: [],
            lineEndPaintAdvances: [],
            kinds: [],
            simpleLineWalkFastPath: true,
            segLevels: null,
            breakableFitAdvances: [],
            breakablePreferredBreaks: [],
            letterSpacing: 0,
            spacingGraphemeCounts: [],
            discretionaryHyphenWidth: 0,
            tabStopAdvance: 0,
            chunks: [],
            segments: [],
        };
    }
    return {
        widths: [],
        lineEndFitAdvances: [],
        lineEndPaintAdvances: [],
        kinds: [],
        simpleLineWalkFastPath: true,
        segLevels: null,
        breakableFitAdvances: [],
        breakablePreferredBreaks: [],
        letterSpacing: 0,
        spacingGraphemeCounts: [],
        discretionaryHyphenWidth: 0,
        tabStopAdvance: 0,
        chunks: [],
    };
}
function countRenderedSpacingGraphemes(text, kind) {
    if (kind === 'zero-width-break' ||
        kind === 'soft-hyphen' ||
        kind === 'hard-break') {
        return 0;
    }
    if (kind === 'tab')
        return 1;
    let count = 0;
    const graphemeSegmenter = getSharedGraphemeSegmenter();
    for (const _ of graphemeSegmenter.segment(text))
        count++;
    return count;
}
function addInternalLetterSpacing(width, graphemeCount, letterSpacing) {
    return graphemeCount > 1 ? width + (graphemeCount - 1) * letterSpacing : width;
}
function measureAnalysis(analysis, font, includeSegments, wordBreak, letterSpacing) {
    const engineProfile = getEngineProfile();
    const { cache, emojiCorrection } = getFontMeasurementState(font, textMayContainEmoji(analysis.normalized));
    const discretionaryHyphenWidth = getCorrectedSegmentWidth('-', getSegmentMetrics('-', cache), emojiCorrection) +
        (letterSpacing === 0 ? 0 : letterSpacing * 2);
    const spaceWidth = getCorrectedSegmentWidth(' ', getSegmentMetrics(' ', cache), emojiCorrection);
    const tabStopAdvance = spaceWidth * 8;
    const hasLetterSpacing = letterSpacing !== 0;
    if (analysis.len === 0)
        return createEmptyPrepared(includeSegments);
    const widths = [];
    const lineEndFitAdvances = [];
    const lineEndPaintAdvances = [];
    const kinds = [];
    let simpleLineWalkFastPath = !hasLetterSpacing;
    const segStarts = includeSegments ? [] : null;
    const breakableFitAdvances = [];
    const breakablePreferredBreaks = [];
    const spacingGraphemeCounts = [];
    const segments = includeSegments ? [] : null;
    const chunks = [];
    let chunkStartSegmentIndex = 0;
    function pushMeasuredSegment(text, width, lineEndFitAdvance, lineEndPaintAdvance, kind, start, breakableFitAdvance, breakablePreferredBreak, spacingGraphemeCount) {
        if (kind !== 'text' && kind !== 'space' && kind !== 'zero-width-break') {
            simpleLineWalkFastPath = false;
        }
        widths.push(width);
        lineEndFitAdvances.push(lineEndFitAdvance);
        lineEndPaintAdvances.push(lineEndPaintAdvance);
        kinds.push(kind);
        segStarts?.push(start);
        breakableFitAdvances.push(breakableFitAdvance);
        breakablePreferredBreaks.push(breakablePreferredBreak);
        if (hasLetterSpacing)
            spacingGraphemeCounts.push(spacingGraphemeCount);
        if (segments !== null)
            segments.push(text);
    }
    function pushMeasuredTextSegment(text, textMetrics, kind, start, allowOverflowBreaks) {
        const spacingGraphemeCount = hasLetterSpacing
            ? countRenderedSpacingGraphemes(text, kind)
            : 0;
        const width = addInternalLetterSpacing(getCorrectedSegmentWidth(text, textMetrics, emojiCorrection), spacingGraphemeCount, letterSpacing);
        const baseLineEndFitAdvance = kind === 'space' || kind === 'preserved-space' || kind === 'zero-width-break'
            ? 0
            : width;
        const lineEndFitAdvance = baseLineEndFitAdvance === 0
            ? 0
            : baseLineEndFitAdvance + (spacingGraphemeCount > 0 ? letterSpacing : 0);
        const lineEndPaintAdvance = kind === 'space' || kind === 'zero-width-break'
            ? 0
            : width;
        if (allowOverflowBreaks && text.length > 1) {
            let fitMode = 'sum-graphemes';
            if (letterSpacing !== 0) {
                fitMode = 'segment-prefixes';
            }
            else if (isNumericRunSegment(text)) {
                fitMode = 'pair-context';
            }
            else if (engineProfile.preferPrefixWidthsForBreakableRuns) {
                fitMode = 'segment-prefixes';
            }
            const fitAdvances = getSegmentBreakableFitAdvances(text, textMetrics, cache, emojiCorrection, fitMode);
            const preferredBreaks = fitAdvances === null || wordBreak === 'keep-all'
                ? null
                : getBreakablePreferredBreaks(text);
            pushMeasuredSegment(text, width, lineEndFitAdvance, lineEndPaintAdvance, kind, start, fitAdvances, preferredBreaks, spacingGraphemeCount);
            return;
        }
        pushMeasuredSegment(text, width, lineEndFitAdvance, lineEndPaintAdvance, kind, start, null, null, spacingGraphemeCount);
    }
    for (let mi = 0; mi < analysis.len; mi++) {
        const segText = analysis.texts[mi];
        const segKind = analysis.kinds[mi];
        const segStart = analysis.starts[mi];
        if (segKind === 'soft-hyphen') {
            pushMeasuredSegment(segText, 0, discretionaryHyphenWidth, discretionaryHyphenWidth, segKind, segStart, null, null, 0);
            continue;
        }
        if (segKind === 'hard-break') {
            const endSegmentIndex = widths.length;
            pushMeasuredSegment(segText, 0, 0, 0, segKind, segStart, null, null, 0);
            chunks.push({
                startSegmentIndex: chunkStartSegmentIndex,
                endSegmentIndex,
                consumedEndSegmentIndex: widths.length,
            });
            chunkStartSegmentIndex = widths.length;
            continue;
        }
        if (segKind === 'tab') {
            pushMeasuredSegment(segText, 0, 0, 0, segKind, segStart, null, null, hasLetterSpacing ? countRenderedSpacingGraphemes(segText, segKind) : 0);
            continue;
        }
        // Measure CJK text only after its final line-break units are known.
        if (segKind === 'text' && isCJK(segText)) {
            const measuredUnits = getCjkTextUnits(segText, engineProfile, wordBreak);
            for (let i = 0; i < measuredUnits.length; i++) {
                const unit = measuredUnits[i];
                const unitMetrics = getSegmentMetrics(unit.text, cache);
                pushMeasuredTextSegment(unit.text, unitMetrics, 'text', segStart + unit.start, unit.overflow === 'grapheme' || (analysis.isWordLike[mi] && (wordBreak === 'keep-all' || unit.overflow === 'word-like')));
            }
            continue;
        }
        pushMeasuredTextSegment(segText, getSegmentMetrics(segText, cache), segKind, segStart, segKind === 'text' && (analysis.isWordLike[mi] || isIndependentSymbolRun(segText)));
    }
    if (chunkStartSegmentIndex < widths.length) {
        chunks.push({
            startSegmentIndex: chunkStartSegmentIndex,
            endSegmentIndex: widths.length,
            consumedEndSegmentIndex: widths.length,
        });
    }
    const segLevels = segStarts === null ? null : computeSegmentLevels(analysis.normalized, segStarts);
    if (segments !== null) {
        return {
            widths,
            lineEndFitAdvances,
            lineEndPaintAdvances,
            kinds,
            simpleLineWalkFastPath,
            segLevels,
            breakableFitAdvances,
            breakablePreferredBreaks,
            letterSpacing,
            spacingGraphemeCounts,
            discretionaryHyphenWidth,
            tabStopAdvance,
            chunks,
            segments,
        };
    }
    return {
        widths,
        lineEndFitAdvances,
        lineEndPaintAdvances,
        kinds,
        simpleLineWalkFastPath,
        segLevels,
        breakableFitAdvances,
        breakablePreferredBreaks,
        letterSpacing,
        spacingGraphemeCounts,
        discretionaryHyphenWidth,
        tabStopAdvance,
        chunks,
    };
}
function prepareInternal(text, font, includeSegments, options) {
    const wordBreak = options?.wordBreak ?? 'normal';
    const letterSpacing = options?.letterSpacing ?? 0;
    const analysis = analyzeText(text, getEngineProfile(), options?.whiteSpace, wordBreak);
    return measureAnalysis(analysis, font, includeSegments, wordBreak, letterSpacing);
}
// Prepare text for layout. Segments the text, measures each segment via canvas,
// and stores the widths for fast relayout at any width. Call once per text block
// (e.g. when a comment first appears). The result is width-independent — the
// same PreparedText can be laid out at any maxWidth and lineHeight via layout().
//
// Steps:
//   1. Normalize collapsible whitespace (CSS white-space: normal behavior)
//   2. Segment via Intl.Segmenter (handles CJK, Thai, etc.)
//   3. Merge punctuation into preceding word ("better." as one unit)
//   4. Split CJK words into individual graphemes (per-character line breaks)
//   5. Measure each segment via canvas measureText, cache by (segment, font)
//   6. Pre-measure graphemes of long words (for overflow-wrap: break-word)
//   7. Correct emoji canvas inflation (auto-detected per font size)
//   8. Optionally compute rich-path bidi metadata for custom renderers
export function prepare(text, font, options) {
    return prepareInternal(text, font, false, options);
}
// Rich variant used by callers that need enough information to render the
// laid-out lines themselves.
export function prepareWithSegments(text, font, options) {
    return prepareInternal(text, font, true, options);
}
function getInternalPrepared(prepared) {
    return prepared;
}
// Layout prepared text at a given max width and caller-provided lineHeight.
// Pure arithmetic on cached widths — no canvas calls, no DOM reads, no string
// operations, and no per-line allocations.
// ~0.0002ms per text block. Call on every resize.
//
// Line breaking rules (matching CSS white-space: normal + overflow-wrap: break-word):
//   - Break before any non-space segment that would overflow the line
//   - Trailing whitespace hangs past the line edge (doesn't trigger breaks)
//   - Segments wider than maxWidth are broken at grapheme boundaries
export function layout(prepared, maxWidth, lineHeight) {
    // Keep the resize hot path specialized. `layoutWithLines()` shares the same
    // break semantics but also tracks line ranges; the extra bookkeeping is too
    // expensive to pay on every hot-path `layout()` call.
    const lineCount = countPreparedLines(getInternalPrepared(prepared), maxWidth);
    return { lineCount, height: lineCount * lineHeight };
}
function createLayoutLine(prepared, cache, width, startSegmentIndex, startGraphemeIndex, endSegmentIndex, endGraphemeIndex) {
    return {
        text: buildLineTextFromRange(prepared, cache, startSegmentIndex, startGraphemeIndex, endSegmentIndex, endGraphemeIndex),
        width,
        start: {
            segmentIndex: startSegmentIndex,
            graphemeIndex: startGraphemeIndex,
        },
        end: {
            segmentIndex: endSegmentIndex,
            graphemeIndex: endGraphemeIndex,
        },
    };
}
function createLayoutLineRange(width, startSegmentIndex, startGraphemeIndex, endSegmentIndex, endGraphemeIndex) {
    return {
        width,
        start: {
            segmentIndex: startSegmentIndex,
            graphemeIndex: startGraphemeIndex,
        },
        end: {
            segmentIndex: endSegmentIndex,
            graphemeIndex: endGraphemeIndex,
        },
    };
}
export function materializeLineRange(prepared, line) {
    return createLayoutLine(prepared, getLineTextCache(prepared), line.width, line.start.segmentIndex, line.start.graphemeIndex, line.end.segmentIndex, line.end.graphemeIndex);
}
// Batch low-level line-range pass. This is the non-materializing counterpart
// to layoutWithLines(), useful for shrinkwrap and other aggregate stats work.
export function walkLineRanges(prepared, maxWidth, onLine) {
    if (prepared.widths.length === 0)
        return 0;
    return walkPreparedLinesRaw(getInternalPrepared(prepared), maxWidth, (width, startSegmentIndex, startGraphemeIndex, endSegmentIndex, endGraphemeIndex) => {
        onLine(createLayoutLineRange(width, startSegmentIndex, startGraphemeIndex, endSegmentIndex, endGraphemeIndex));
    });
}
export function measureLineStats(prepared, maxWidth) {
    return measurePreparedLineGeometry(getInternalPrepared(prepared), maxWidth);
}
// Intrinsic-width helper for rich/userland layout work. This asks "how wide is
// the prepared text when container width is not the thing forcing wraps?".
// Explicit hard breaks still count, so this returns the widest forced line.
export function measureNaturalWidth(prepared) {
    let maxWidth = 0;
    walkPreparedLinesRaw(getInternalPrepared(prepared), Number.POSITIVE_INFINITY, width => {
        if (width > maxWidth)
            maxWidth = width;
    });
    return maxWidth;
}
export function layoutNextLine(prepared, start, maxWidth) {
    const internal = getInternalPrepared(prepared);
    const end = {
        segmentIndex: start.segmentIndex,
        graphemeIndex: start.graphemeIndex,
    };
    const chunkIndex = normalizePreparedLineStart(internal, end);
    if (chunkIndex < 0)
        return null;
    const lineStartSegmentIndex = end.segmentIndex;
    const lineStartGraphemeIndex = end.graphemeIndex;
    const width = stepPreparedLineGeometryFromChunk(internal, end, chunkIndex, maxWidth);
    if (width === null)
        return null;
    return createLayoutLine(prepared, getLineTextCache(prepared), width, lineStartSegmentIndex, lineStartGraphemeIndex, end.segmentIndex, end.graphemeIndex);
}
export function layoutNextLineRange(prepared, start, maxWidth) {
    const internal = getInternalPrepared(prepared);
    const end = {
        segmentIndex: start.segmentIndex,
        graphemeIndex: start.graphemeIndex,
    };
    const chunkIndex = normalizePreparedLineStart(internal, end);
    if (chunkIndex < 0)
        return null;
    const lineStartSegmentIndex = end.segmentIndex;
    const lineStartGraphemeIndex = end.graphemeIndex;
    const width = stepPreparedLineGeometryFromChunk(internal, end, chunkIndex, maxWidth);
    if (width === null)
        return null;
    return createLayoutLineRange(width, lineStartSegmentIndex, lineStartGraphemeIndex, end.segmentIndex, end.graphemeIndex);
}
// Rich layout API for callers that want the actual line contents and widths.
// Caller still supplies lineHeight at layout time. Mirrors layout()'s break
// decisions, but keeps extra per-line bookkeeping so it should stay off the
// resize hot path.
export function layoutWithLines(prepared, maxWidth, lineHeight) {
    const lines = [];
    if (prepared.widths.length === 0)
        return { lineCount: 0, height: 0, lines };
    const graphemeCache = getLineTextCache(prepared);
    const lineCount = walkPreparedLinesRaw(getInternalPrepared(prepared), maxWidth, (width, startSegmentIndex, startGraphemeIndex, endSegmentIndex, endGraphemeIndex) => {
        lines.push(createLayoutLine(prepared, graphemeCache, width, startSegmentIndex, startGraphemeIndex, endSegmentIndex, endGraphemeIndex));
    });
    return { lineCount, height: lineCount * lineHeight, lines };
}
export function clearCache() {
    clearAnalysisCaches();
    clearLineTextCaches();
    clearMeasurementCaches();
}
export function setLocale(locale) {
    setAnalysisLocale(locale);
    clearCache();
}
