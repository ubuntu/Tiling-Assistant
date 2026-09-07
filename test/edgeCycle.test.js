import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DEFAULT_EDGE_DIVISIONS,
    detectEdgeDivision,
    isFullHeightEdgeRect,
    makeEdgeRect,
    nextDivision
} from '../tiling-assistant@leleat-on-github/src/extension/edgeCycle.js';

const workArea = { x: 0, y: 0, width: 1200, height: 800 };

test('cycles the default divisions and wraps to the first division', () => {
    assert.deepEqual(DEFAULT_EDGE_DIVISIONS, [2, 3, 4]);
    assert.equal(nextDivision(undefined), 2);
    assert.equal(nextDivision(2), 3);
    assert.equal(nextDivision(3), 4);
    assert.equal(nextDivision(4), 2);
    assert.equal(nextDivision(99), 2);
});

test('creates equal-width rectangles anchored to the left edge', () => {
    assert.deepEqual(makeEdgeRect(workArea, 'left', 2), {
        x: 0,
        y: 0,
        width: 600,
        height: 800
    });
    assert.deepEqual(makeEdgeRect(workArea, 'left', 3), {
        x: 0,
        y: 0,
        width: 400,
        height: 800
    });
    assert.deepEqual(makeEdgeRect(workArea, 'left', 4), {
        x: 0,
        y: 0,
        width: 300,
        height: 800
    });
});

test('creates equal-width rectangles anchored to the right edge', () => {
    assert.deepEqual(makeEdgeRect(workArea, 'right', 2), {
        x: 600,
        y: 0,
        width: 600,
        height: 800
    });
    assert.deepEqual(makeEdgeRect(workArea, 'right', 3), {
        x: 800,
        y: 0,
        width: 400,
        height: 800
    });
    assert.deepEqual(makeEdgeRect(workArea, 'right', 4), {
        x: 900,
        y: 0,
        width: 300,
        height: 800
    });
});

test('keeps the final pixel in the work area for an odd width', () => {
    const oddWorkArea = { x: -1920, y: 10, width: 1919, height: 1080 };
    const rects = [2, 3, 4].map(division => makeEdgeRect(oddWorkArea, 'left', division));

    rects.forEach(rect => {
        assert.equal(rect.x, oddWorkArea.x);
        assert.equal(rect.y, oddWorkArea.y);
        assert.equal(rect.height, oddWorkArea.height);
        assert.ok(rect.width > 0);
        assert.ok(rect.x + rect.width <= oddWorkArea.x + oddWorkArea.width);
    });

    const right = makeEdgeRect(oddWorkArea, 'right', 3);
    assert.equal(right.x + right.width, oddWorkArea.x + oddWorkArea.width);
});

test('detects only full-height rectangles at the requested edge', () => {
    const leftThird = makeEdgeRect(workArea, 'left', 3);
    const rightQuarter = makeEdgeRect(workArea, 'right', 4);

    assert.equal(isFullHeightEdgeRect(leftThird, workArea, 'left'), true);
    assert.equal(isFullHeightEdgeRect(rightQuarter, workArea, 'right'), true);
    assert.equal(detectEdgeDivision(leftThird, workArea, 'left'), 3);
    assert.equal(detectEdgeDivision(rightQuarter, workArea, 'right'), 4);
    assert.equal(detectEdgeDivision(leftThird, workArea, 'right'), null);
    assert.equal(detectEdgeDivision({ ...leftThird, y: 10 }, workArea, 'left'), null);
    assert.equal(detectEdgeDivision({ ...leftThird, height: 798 }, workArea, 'left'), null);
    assert.equal(detectEdgeDivision({ ...leftThird, x: 20 }, workArea, 'left'), null);
});

test('allows a small coordinate tolerance when detecting a tile', () => {
    const leftHalf = makeEdgeRect(workArea, 'left', 2);
    const shifted = { ...leftHalf, x: 1, y: 1, width: 599, height: 799 };

    assert.equal(detectEdgeDivision(shifted, workArea, 'left'), 2);
    assert.equal(detectEdgeDivision(shifted, workArea, 'left', [2], 0), null);
});
