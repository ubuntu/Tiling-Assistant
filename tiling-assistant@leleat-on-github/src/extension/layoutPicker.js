import { Clutter, GLib, GObject, St, Gio } from '../dependencies/gi.js';
import { Main } from '../dependencies/shell.js';

import { Settings } from '../common.js';
import { Util } from './utility.js';

const LayoutPickerVisibility = {
    HIDDEN: 0,
    PEAK: 1,
    SHOWN: 2
};

function iconPath(name) {
    return GLib.build_filenamev([
        Settings.getExtension().path,
        'media',
        `${name}-symbolic.svg`
    ]);
}

export const LayoutPickerTileType = Object.freeze({
    NONE: 0,
    LEFT: 1,
    RIGHT: 2,
    TOP: 3,
    BOTTOM: 4,
    Q1: 5,
    Q2: 6,
    Q3: 7,
    Q4: 8,
    MAXIMIZE: 9,
    LAYOUT: 10
});

// omit '-symbolic.svg' as it is managed by iconPath function already
const ICONS = {
    vertical: {
        none: 'tile-vertical',

        states: {
            [LayoutPickerTileType.TOP]: 'tile-top',
            [LayoutPickerTileType.BOTTOM]: 'tile-bottom'
        }
    },

    horizontal: {
        none: 'tile-horizontal',

        states: {
            [LayoutPickerTileType.LEFT]: 'tile-left',
            [LayoutPickerTileType.RIGHT]: 'tile-right'
        }
    },

    quarter: {
        none: 'tile-quarter',

        states: {
            [LayoutPickerTileType.Q1]: 'tile-q1',
            [LayoutPickerTileType.Q2]: 'tile-q2',
            [LayoutPickerTileType.Q3]: 'tile-q3',
            [LayoutPickerTileType.Q4]: 'tile-q4'
        }
    },

    maximize: {
        none: 'tile-base',

        states: {
            [LayoutPickerTileType.MAXIMIZE]: 'tile-maximize'
        }
    }
};

export const LayoutPicker = GObject.registerClass({
    Properties: {
        'tile-type': GObject.ParamSpec.int(
            'tile-type', 'tile-type', 'tile-type',
            GObject.ParamFlags.READWRITE,
            LayoutPickerTileType.NONE,
            LayoutPickerTileType.LAYOUT,
            LayoutPickerTileType.NONE
        )
    }
}, class LayoutPicker extends St.Bin {
    _init() {
        super._init({
            style_class: 'tiling-menu-container'
        });

        this._container = new St.BoxLayout({
            x_expand: true,
            orientation: Clutter.Orientation.HORIZONTAL,
            style_class: 'popup-menu-content'
        });

        this._visibility = LayoutPickerVisibility.HIDDEN;
        this._dragging = false;

        this.set_child(this._container);

        this._addChrome();

        this._icons = {};

        for (const [group, config] of Object.entries(ICONS)) {
            // start with icons that appear to be not hovered
            const icon = this._createIcon(config.none);

            config.icon = icon;
            this._icons[group] = icon;

            this._container.add_child(icon);
        }

        // Icons for the user's layouts. They are rebuilt on every move since
        // the layouts may have changed on the disk in the meantime.
        this._layoutIcons = [];

        // The layout and the index of its item, which was picked, if the tile
        // type is LayoutPickerTileType.LAYOUT
        this.pickedLayoutItem = null;

        // e.g a dock is enabled and or disabled
        global.display.connectObject('workareas-changed', () => {
            this._updateAllocation(global.display.get_current_monitor());
        }, this);

        Main.layoutManager.connectObject('monitors-changed', () => {
            this._updateAllocation(global.display.get_current_monitor());
        }, this);

        // GNOME Shell doesn't disable extensions when shutting down, so stop
        // reacting to monitor and work-area changes as soon as it shuts down.
        global.connectObject('shutdown', () => {
            global.display.disconnectObject(this);
            Main.layoutManager.disconnectObject(this);
        }, this);

        // The picker only needs to know when the move it reacts to is over,
        // so it can hide itself without the move handler having to track it.
        global.display.connectObject('grab-op-end', () => this.onMoveFinished(), this);

        // just in case extension is enabled and disable
        this._updateAllocation(global.display.get_current_monitor());

        this.connectObject('notify::translation-y', () => {
            this.set_clip(
                0,
                this.height - this.translation_y,
                this.width,
                this.height
            );
        }, this);
    }

    _setVisibility(visibility) {
        if (this._visibility === visibility)
            return;

        this._visibility = visibility;

        this.opacity = 255;
        this.reactive = true;


        let positions = [
            0,
            this._container.get_theme_node().get_padding(St.Side.Bottom) +
                this.get_theme_node().get_padding(St.Side.BOTTOM),
            this.height
        ];

        this.remove_all_transitions();

        this.ease({
            translation_y: positions[visibility],
            duration: 250,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                this.opacity = this._visibility !== LayoutPickerVisibility.HIDDEN ? 255 : 0;
                this.reactive = this._visibility !== LayoutPickerVisibility.HIDDEN;

                // once picker is fully shown onMoving might not be able to update tile type
                // for situations like no cursor update after picker is fully shown.
                // this could causes incorrect tile type shown.
                if (this._visibility === LayoutPickerVisibility.SHOWN) {
                    let [curX, curY] = global.get_pointer();
                    this._updateLayoutPickerTileType(curX, curY);
                }
            }

        });
    }

    onMoving(curX, curY, monitorIndex = global.display.get_current_monitor()) {
        if (this._dragging === false)
            return;

        this._updateAllocation(monitorIndex);

        let [w, h] = this.get_size();
        let [mx, my_] = this.get_transformed_position();

        const themeNode = this.get_theme_node();
        let paddingLeft = themeNode.get_padding(St.Side.LEFT);
        let paddingRight = themeNode.get_padding(St.Side.RIGHT);
        let paddingBottom = this.get_theme_node().get_padding(St.Side.BOTTOM);

        const monitorArea = Main.layoutManager.monitors[monitorIndex];
        const activeWs = global.workspace_manager.get_active_workspace();
        const workArea = activeWs.get_work_area_for_monitor(monitorIndex);

        // using monitorArea.y instead  of workArea.y as upper bound to compensate with chromes such us the top bar height
        // placing cursor above workArea.y causes visibility glitch. workArea.y and monitorArea.y will be same for other monitor anyways.
        if (
            curY >= monitorArea.y &&
            curY <= workArea.y + h - paddingBottom &&
            curX >= mx + paddingLeft &&
            curX <= mx + w - paddingRight
        )
            this._setVisibility(LayoutPickerVisibility.SHOWN);
        else
            this._setVisibility(LayoutPickerVisibility.PEAK);

        if (this._visibility === LayoutPickerVisibility.SHOWN)
            this._updateLayoutPickerTileType(curX, curY);
        else
            this._resetTileType();
    }

    onMoveStarted() {
        const monitorIndex = global.display.get_current_monitor();

        this._dragging = true;
        this._syncLayoutIcons(monitorIndex);
        this._updateAllocation(monitorIndex);
        this._resetTileType();
        this._setVisibility(LayoutPickerVisibility.PEAK);
    }

    onMoveFinished() {
        this._dragging = false;
        this._resetTileType();
        this._setVisibility(LayoutPickerVisibility.HIDDEN);
    }

    _resetTileType() {
        this.tileType = LayoutPickerTileType.NONE;
        this.pickedLayoutItem = null;
        this._clearIcons();
    }

    _syncLayoutIcons(monitorIndex) {
        this._layoutIcons.forEach(icon => icon.destroy());
        this._layoutIcons = [];

        if (!Settings.getBoolean('layout-picker-show-layouts'))
            return;

        // The layouts file may have been edited by hand, so don't trust it.
        // An error here would break the whole window move.
        const layouts = Util.getLayouts();
        if (!Array.isArray(layouts))
            return;

        const activeWs = global.workspace_manager.get_active_workspace();
        const workArea = activeWs.get_work_area_for_monitor(monitorIndex);

        for (const layout of layouts) {
            if (!isPickableLayout(layout))
                continue;

            const icon = new LayoutPickerLayoutIcon(layout);
            this._container.add_child(icon);

            // Don't let the picker grow wider than the screen. Otherwise, the
            // outer tiles couldn't be reached with the pointer.
            if (workArea && this.get_preferred_width(-1)[1] > workArea.width) {
                icon.destroy();
                break;
            }

            this._layoutIcons.push(icon);
        }
    }

    _setLayoutPickerIcon(tileType) {
        this._clearIcons();

        for (const config of Object.values(ICONS)) {
            const iconName = config.states[tileType];

            if (!iconName)
                continue;

            this._updateIcon(config.icon, iconName);
            break;
        }
    }

    _createIcon(name) {
        let fallback_gicon = Gio.FileIcon.new(
            Gio.File.new_for_path(iconPath(name))
        );

        let gicon = new Gio.ThemedIcon({
            name: `${name}-symbolic`
        });

        return new St.Icon({
            gicon,
            fallback_gicon
        });
    }

    _updateIcon(icon, name) {
        let fallback_gicon = Gio.FileIcon.new(
            Gio.File.new_for_path(iconPath(name))
        );

        let gicon = new Gio.ThemedIcon({
            name: `${name}-symbolic`
        });
        icon.set({
            gicon,
            fallback_gicon
        });
    }

    /**
     * @param {LayoutPickerLayoutIcon|null} keptLayoutIcon a layout icon, whose
     *      highlight is about to be set anyway. It isn't cleared to not repaint
     *      it twice.
     */
    _clearIcons(keptLayoutIcon = null) {
        for (const config of Object.values(ICONS))
            this._updateIcon(config.icon, config.none);

        this._layoutIcons.forEach(icon => {
            if (icon !== keptLayoutIcon)
                icon.setActiveItem(-1);
        });
    }

    _updateLayoutPickerTileType(curX, curY) {
        let rect = icon => {
            let [x, y] = icon.get_transformed_position();
            let [w, h] = icon.get_size();
            return { x, y, w, h };
        };

        this.pickedLayoutItem = null;

        let contains = ({ x, y, w, h }) =>
            curX >= x &&
        curX <= x + w &&
        curY >= y &&
        curY <= y + h;
        const horizontal = rect(this._icons.horizontal);

        if (contains(horizontal)) {
            const leftPortion = curX < horizontal.x + horizontal.w / 2;

            this.tileType = leftPortion
                ? LayoutPickerTileType.LEFT
                : LayoutPickerTileType.RIGHT;

            this._setLayoutPickerIcon(this.tileType);
            return;
        }

        const vertical = rect(this._icons.vertical);

        if (contains(vertical)) {
            const topPortion = curY <= vertical.y + vertical.h / 2;

            this.tileType = topPortion
                ? LayoutPickerTileType.TOP
                : LayoutPickerTileType.BOTTOM;

            this._setLayoutPickerIcon(this.tileType);
            return;
        }

        const quarter = rect(this._icons.quarter);

        if (contains(quarter)) {
            const leftPortion = curX < quarter.x + quarter.w / 2;
            const topPortion = curY <= quarter.y + quarter.h / 2;

            if (topPortion)
            { this.tileType = leftPortion
                ? LayoutPickerTileType.Q2
                : LayoutPickerTileType.Q1; }
            else
            { this.tileType = leftPortion
                ? LayoutPickerTileType.Q3
                : LayoutPickerTileType.Q4; }

            this._setLayoutPickerIcon(this.tileType);
            return;
        }

        for (const icon of this._layoutIcons) {
            if (!contains(rect(icon)))
                continue;

            const index = icon.getItemIndexAt(curX, curY);

            if (index === -1)
                break;

            this.pickedLayoutItem = { layout: icon.layout, index };
            this.tileType = LayoutPickerTileType.LAYOUT;
            this._clearIcons(icon);
            icon.setActiveItem(index);
            return;
        }

        this.tileType = contains(rect(this._icons.maximize))
            ? LayoutPickerTileType.MAXIMIZE
            : LayoutPickerTileType.NONE;

        this._setLayoutPickerIcon(this.tileType);
    }

    _updateAllocation(monitorIndex) {
        // The current monitor can already be gone (e.g. when the last monitor
        // is removed during shutdown), so make sure it still exists before
        // asking Mutter for its work area.
        if (!Main.layoutManager.monitors[monitorIndex])
            return;

        const activeWs = global.workspace_manager.get_active_workspace();
        const workArea = activeWs.get_work_area_for_monitor(monitorIndex);

        if (workArea === null)
            return;

        const [, natWidth] = this.get_preferred_width(-1);
        const [, natHeight] = this.get_preferred_height(-1);

        const targetX = Math.round(workArea.x + (workArea.width - natWidth) / 2);
        const targetY = Math.round(workArea.y - natHeight);

        if (targetX === this.x && targetY === this.y)
            return;

        this.set_position(targetX, targetY);

        this.remove_all_transitions();

        this._visibility = LayoutPickerVisibility.HIDDEN;
        this.translation_y = 0;
        this.opacity = 0;
        this.reactive = false;
    }

    _addChrome() {
        Main.layoutManager.addChrome(this, {
            affectsStruts: false,
            trackFullscreen: false
        });
    }

    _untrackChrome() {
        Main.layoutManager.untrackChrome(this);
    }

    destroy() {
        this._untrackChrome();

        global.display.disconnectObject(this);
        Main.layoutManager.disconnectObject(this);

        super.destroy();
    }
});

// Tolerance for rounding errors of the rect ratios (e.g. 2 / 5 + 1 / 5 > 3 / 5)
const RATIO_EPSILON = 1e-6;

/**
 * Only valid layouts with static rects can be shown in the picker. Layouts with
 * dynamic (looping) items don't have a fixed set of tiles.
 *
 * The checks are the same as in Layout.validate(), which is used when saving a
 * layout in the prefs, but they tolerate rounding errors like the favorite
 * layout does.
 *
 * @param {object} layout a layout as parsed from the layouts file.
 * @returns {boolean}
 */
function isPickableLayout(layout) {
    const isStaticItem = item =>
        item !== null && typeof item === 'object' && !item.loopType &&
        ['x', 'y', 'width', 'height'].every(key => Number.isFinite(item.rect?.[key]));

    if (!Array.isArray(layout?._items) || !layout._items.length ||
            !layout._items.every(isStaticItem))
        return false;

    const rects = layout._items.map(item => item.rect);
    const isOnScreen = ({ x, y, width, height }) =>
        width > 0 && height > 0 &&
        x >= -RATIO_EPSILON && y >= -RATIO_EPSILON &&
        x + width <= 1 + RATIO_EPSILON && y + height <= 1 + RATIO_EPSILON;
    const getOverlap = (r1, r2, pos, size) =>
        Math.min(r1[pos] + r1[size], r2[pos] + r2[size]) - Math.max(r1[pos], r2[pos]);
    const overlap = (r1, r2) =>
        getOverlap(r1, r2, 'x', 'width') > RATIO_EPSILON &&
        getOverlap(r1, r2, 'y', 'height') > RATIO_EPSILON;

    return rects.every(isOnScreen) &&
        rects.every((r1, i) => rects.slice(i + 1).every(r2 => !overlap(r1, r2)));
}

// Dimensions in the coordinate space of the 64x64 tile-*-symbolic.svg icons,
// so the drawn layouts look like the other icons of the picker.
const ICON_SIZE = 64;
const TILE_GAP = 2;
const TILE_BORDER_WIDTH = 3;
const TILE_BORDER_RADIUS = 8;
const TILE_BORDER_OPACITY = 0.35;
const ACTIVE_TILE_INSET = 5;
const ACTIVE_TILE_RADIUS = 3;
// Tolerance for considering a ratio to be at the edge of the layout
const EDGE_EPSILON = 0.01;

/**
 * Adds a rect with the given corner radii to the current path.
 *
 * @param {Cairo.Context} cr
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @param {number[]} radii [topLeft, topRight, bottomRight, bottomLeft]
 */
function roundedRectPath(cr, x1, y1, x2, y2, [tl, tr, br, bl]) {
    cr.newSubPath();
    cr.moveTo(x1 + tl, y1);
    cr.lineTo(x2 - tr, y1);
    if (tr)
        cr.arc(x2 - tr, y1 + tr, tr, -Math.PI / 2, 0);
    cr.lineTo(x2, y2 - br);
    if (br)
        cr.arc(x2 - br, y2 - br, br, 0, Math.PI / 2);
    cr.lineTo(x1 + bl, y2);
    if (bl)
        cr.arc(x1 + bl, y2 - bl, bl, Math.PI / 2, Math.PI);
    cr.lineTo(x1, y1 + tl);
    if (tl)
        cr.arc(x1 + tl, y1 + tl, tl, Math.PI, 3 * Math.PI / 2);
    cr.closePath();
}

/**
 * An icon of the layout picker, which draws a user-defined layout in the style
 * of the tile-*-symbolic.svg icons. Each of the layout's items can be picked.
 */
const LayoutPickerLayoutIcon = GObject.registerClass(
class LayoutPickerLayoutIcon extends St.DrawingArea {
    _init(layout) {
        super._init({ style_class: 'tiling-layout-picker-layout' });

        this.layout = layout;
        this._activeItem = -1;
    }

    /**
     * @param {number} x the stage x coordinate
     * @param {number} y the stage y coordinate
     * @returns {number} the index of the layout's item at the position or -1.
     */
    getItemIndexAt(x, y) {
        const [iconX, iconY] = this.get_transformed_position();
        const [width, height] = this.get_size();
        // Map to the centered square, in which the layout is drawn
        const size = Math.min(width, height);
        const ratioX = (x - iconX - (width - size) / 2) / size;
        const ratioY = (y - iconY - (height - size) / 2) / size;

        return this.layout._items.findIndex(({ rect }) =>
            ratioX >= rect.x && ratioX <= rect.x + rect.width &&
            ratioY >= rect.y && ratioY <= rect.y + rect.height);
    }

    /**
     * @param {number} index the index of the layout's item to highlight. -1
     *      to not highlight any item.
     */
    setActiveItem(index) {
        if (this._activeItem === index)
            return;

        this._activeItem = index;
        this.queue_repaint();
    }

    vfunc_repaint() {
        const cr = this.get_context();
        const [width, height] = this.get_surface_size();
        const color = this.get_theme_node().get_foreground_color();
        const scale = Math.min(width, height) / ICON_SIZE;
        const offsetX = (width - ICON_SIZE * scale) / 2;
        const offsetY = (height - ICON_SIZE * scale) / 2;
        const toX = x => offsetX + x * scale;
        const toY = y => offsetY + y * scale;

        const tiles = this.layout._items.map(({ rect }) => {
            const atLeft = rect.x < EDGE_EPSILON;
            const atTop = rect.y < EDGE_EPSILON;
            const atRight = rect.x + rect.width > 1 - EDGE_EPSILON;
            const atBottom = rect.y + rect.height > 1 - EDGE_EPSILON;
            const halfGap = TILE_GAP / 2;

            return {
                x1: rect.x * ICON_SIZE + (atLeft ? 0 : halfGap),
                y1: rect.y * ICON_SIZE + (atTop ? 0 : halfGap),
                x2: (rect.x + rect.width) * ICON_SIZE - (atRight ? 0 : halfGap),
                y2: (rect.y + rect.height) * ICON_SIZE - (atBottom ? 0 : halfGap),
                // Only the corners of the icon itself are rounded
                roundCorners: [
                    atTop && atLeft,
                    atTop && atRight,
                    atBottom && atRight,
                    atBottom && atLeft
                ]
            };
        });

        cr.setSourceColor(color);

        // Draw the outlines of all tiles in a group so that the overlapping
        // outlines of adjacent tiles don't add up their opacity.
        cr.pushGroup();
        cr.setLineWidth(TILE_BORDER_WIDTH * scale);
        const borderInset = TILE_BORDER_WIDTH / 2;
        for (const { x1, y1, x2, y2, roundCorners } of tiles) {
            roundedRectPath(cr,
                toX(x1 + borderInset), toY(y1 + borderInset),
                toX(x2 - borderInset), toY(y2 - borderInset),
                roundCorners.map(round => round
                    ? (TILE_BORDER_RADIUS - borderInset) * scale
                    : 0));
        }
        cr.stroke();
        cr.popGroupToSource();
        cr.paintWithAlpha(TILE_BORDER_OPACITY);

        const activeTile = tiles[this._activeItem];
        if (activeTile) {
            const { x1, y1, x2, y2, roundCorners } = activeTile;
            // Shrink the inset for small tiles so that they remain visible
            const inset = Math.min(ACTIVE_TILE_INSET, (x2 - x1) / 4, (y2 - y1) / 4);

            cr.setSourceColor(color);
            roundedRectPath(cr,
                toX(x1 + inset), toY(y1 + inset),
                toX(x2 - inset), toY(y2 - inset),
                roundCorners.map(round => round ? ACTIVE_TILE_RADIUS * scale : 0));
            cr.fill();
        }

        cr.$dispose();
    }
});
