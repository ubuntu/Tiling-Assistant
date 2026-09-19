export const DEFAULT_EDGE_DIVISIONS = Object.freeze([2, 3, 4]);

const SUPPORTED_SIDES = new Set(['left', 'right']);

function isClose(actual, expected, tolerance) {
    return Math.abs(actual - expected) <= tolerance;
}

function isValidDivision(division) {
    return Number.isInteger(division) && division > 0;
}

function validateDivisions(divisions) {
    if (!divisions.length || divisions.some(division => !isValidDivision(division)))
        throw new TypeError('divisions must contain positive integers');
}

function validateSide(side) {
    if (!SUPPORTED_SIDES.has(side))
        throw new TypeError(`Unsupported edge side: ${side}`);
}

export function nextDivision(currentDivision, divisions = DEFAULT_EDGE_DIVISIONS) {
    validateDivisions(divisions);

    const currentIndex = divisions.indexOf(currentDivision);
    return divisions[(currentIndex + 1) % divisions.length];
}

export function makeEdgeRect(workArea, side, division) {
    validateSide(side);
    if (!isValidDivision(division))
        throw new TypeError('division must be a positive integer');

    const width = Math.floor(workArea.width / division);
    const x = side === 'left'
        ? workArea.x
        : workArea.x + workArea.width - width;

    return {
        x,
        y: workArea.y,
        width,
        height: workArea.height
    };
}

export function isFullHeightEdgeRect(rect, workArea, side, tolerance = 1) {
    validateSide(side);

    if (!rect || !workArea || tolerance < 0)
        return false;

    const atLeftEdge = isClose(rect.x, workArea.x, tolerance);
    const atRightEdge = isClose(
        rect.x + rect.width,
        workArea.x + workArea.width,
        tolerance
    );
    const atTopEdge = isClose(rect.y, workArea.y, tolerance);
    const fullHeight = isClose(rect.height, workArea.height, tolerance);

    return atTopEdge && fullHeight && (side === 'left' ? atLeftEdge : atRightEdge);
}

export function detectEdgeDivision(
    rect,
    workArea,
    side,
    divisions = DEFAULT_EDGE_DIVISIONS,
    tolerance = 1
) {
    validateDivisions(divisions);

    if (!isFullHeightEdgeRect(rect, workArea, side, tolerance))
        return null;

    return divisions.find(division => {
        const expected = makeEdgeRect(workArea, side, division);
        return isClose(rect.x, expected.x, tolerance) &&
            isClose(rect.y, expected.y, tolerance) &&
            isClose(rect.width, expected.width, tolerance) &&
            isClose(rect.height, expected.height, tolerance);
    }) ?? null;
}
