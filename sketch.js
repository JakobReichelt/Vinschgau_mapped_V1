// Südtirol walkways: a grid of path names (grey) and river names (blue)
// in the background, the walkways (white) and rivers (blue) on top.
// Hover a name to preview that path or river, click it to select it:
// everything else gets faint, the lines close to it fade in.
// A path and a river can be selected at the same time.
// Click a selected name again to deselect it, click an empty cell to see
// everything again.
// The bottom row has two search fields: type a path name on the left or a
// river name on the right: the name completes itself,
// arrow up / down switch between the fitting names, Enter takes it.
// They also show the selected or hovered path / river.
// Press "s" to download the current picture as an SVG file.

// Road types (OSM "fclass") that count as walkways
const WALK_TYPES = [
    "footway",
    "pedestrian",
    "path",
    "steps",
    "track",
    "track_grade3",
    "track_grade4",
    "track_grade5",
];

const TEXT_SIZE = 3;
const LINE_HEIGHT = 4;
const CELL_PADDING = 2;
const LABEL_MARGIN = 4;

// When something is selected, all lines stay visible with at least the
// minimum opacity. Lines closer than the radius (in pixels) to the
// selected path or river fade in: the closer, the more visible.
const PATH_MIN_OPACITY = 0.35;
const WATER_MIN_OPACITY = 0.15;
const PATH_FADE_RADIUS = 60;
const WATER_FADE_RADIUS = 80;

// Small river names on the map (the river name in the bottom row stays)
const SHOW_WATER_LABELS = false;

// The SVG only refers to the font by name: it shows up correctly
// where Canilari is installed, otherwise as sans-serif.
const FONT_FILE = "assets/Font canilari/Canilari-Pro.ttf";
const SVG_FONT_FAMILY = "Canilari-Pro, sans-serif";

let font;
let roads;
let waterways;
let projection;

// Everything is calculated once in setup() and stored here,
// so draw() and the SVG export show exactly the same picture.
let roadLines = [];   // { name, points, cx, cy }  (cx, cy = center of the line)
let waterLines = [];  // { name, points, cx, cy }
let grid;             // { cols, rows, cellW, cellH }
let gridLabels = [];  // { x, y, lines, type }  (lines = text lines, type = "path" or "river")
let cellItems = [];   // { type, name } for every grid cell (null = empty cell)
let waterLabels = []; // { x, y, lines }

// Drawing all ~230000 line points takes long, so the map is drawn only once
// into two pictures. One of them is visible behind the canvas, draw() only
// draws the highlighted lines on top.
let fullPicture;      // grid, names and all lines fully visible
let dimPicture;       // the same with all lines at their minimum opacity

// Selection state: a path and a river can be selected at the same time
let selectedPath = null;  // name of the selected path (null = none)
let selectedRiver = null; // name of the selected river (null = none)
let pathCell = -1;        // grid cell of the selected path (-1 = none)
let riverCell = -1;       // grid cell of the selected river (-1 = none)
let roadOpacity = [];     // opacity (0 to 1) for every entry in roadLines
let waterOpacity = [];    // opacity (0 to 1) for every entry in waterLines
let hoveredCell = -1;     // grid cell under the mouse (-1 = none)
let hoveredPath = null;   // name of the path in the hovered cell
let hoveredRiver = null;  // name of the river in the hovered cell

// Search fields in the bottom row: paths on the left, rivers on the right
let pathInput;
let riverInput;
let pathNames = [];   // all path names, A to Z
let riverNames = [];  // all river names, A to Z

async function setup() {
    createCanvas(windowWidth, windowHeight);
    // For style.css: this canvas lies above the map pictures
    drawingContext.canvas.classList.add("sketch-canvas");

    roads = await loadJSON("assets/roads.geojson");
    waterways = await loadJSON("assets/waterways.geojson");
    font = await loadFont(FONT_FILE);

    // textWidth() needs the font and text size to measure correctly
    textFont(font);
    textSize(TEXT_SIZE);

    // The grid comes first: the map has to fit between its top and bottom row
    makeGridLabels();

    // Turns [longitude, latitude] into [x, y] so the map fits the canvas
    projection = d3.geoMercator().fitExtent(
        [
            [20, grid.cellH + 10],
            [width - 20, height - grid.cellH - 10],
        ],
        roads
    );

    for (let feature of roads.features) {
        if (isWalkway(feature)) {
            for (let line of projectLines(feature)) {
                roadLines.push(makeLine(feature, line));
            }
        }
    }
    for (let feature of waterways.features) {
        for (let line of projectLines(feature)) {
            waterLines.push(makeLine(feature, line));
        }
    }

    makeWaterLabels();
    fullPicture = makePicture(1, 1);
    dimPicture = makePicture(PATH_MIN_OPACITY, WATER_MIN_OPACITY);
    updateOpacity();
    makeSearchFields();

    // Leaving the canvas (also onto a search field) ends the hover preview
    drawingContext.canvas.addEventListener("mouseleave", () => hoverCell(-1));

    // draw() only runs again when something changes (see mouseClicked, mouseMoved)
    noLoop();
}

function draw() {
    // The map pictures lie behind the canvas (see style.css), so the canvas
    // stays transparent and only gets what changes. Copying a picture into
    // the canvas with image() would be slow on big / high resolution screens.
    let nothingShown = shownPath() === null && shownRiver() === null;
    showPicture(fullPicture, nothingShown);
    showPicture(dimPicture, !nothingShown);
    clear();

    // On the faint map: only the lines close to the shown path / river
    if (!nothingShown) {
        noFill();
        drawHighlights(roadLines, roadOpacity, PATH_MIN_OPACITY, isShownRoad, [255, 255, 255]);
        drawHighlights(waterLines, waterOpacity, WATER_MIN_OPACITY, isShownRiver, [100, 100, 255]);
    }

    // Frame around the hovered cell (grey) and the selected cells (white)
    noFill();
    strokeWeight(0.5);
    if (hoveredCell !== -1 && cellItems[hoveredCell] !== null) {
        stroke(128);
        drawCellFrame(hoveredCell);
    }
    stroke(255);
    for (let cell of [pathCell, riverCell]) {
        if (cell !== -1) {
            drawCellFrame(cell);
        }
    }

    // The big names in the bottom row are the search fields
    // (HTML inputs on top of the canvas, see makeSearchFields)
}

function keyPressed() {
    // Typing in a search field should not save the SVG
    if (document.activeElement.tagName === "INPUT") {
        return;
    }
    if (key === "s" || key === "S") {
        saveSvg();
    }
}

function mouseClicked(event) {
    // The data may still be loading, and clicks into a search field
    // are handled by the field itself
    if (!grid || (event && event.target.tagName === "INPUT")) {
        return;
    }

    // A path cell selects its path, a river cell its river (the same as
    // typing the name into the search field). The other selection stays.
    // Clicking a selected cell deselects it, an empty cell deselects both.
    let cell = cellUnderMouse();
    let item = cell === -1 ? null : cellItems[cell];
    if (item === null) {
        selectPath(null);
        selectRiver(null);
    } else if (cell === pathCell || cell === riverCell) {
        // Stop the hover preview too, otherwise the deselected path / river
        // would stay visible until the mouse leaves the cell
        hoveredPath = null;
        hoveredRiver = null;
        if (item.type === "path") {
            selectPath(null);
        } else {
            selectRiver(null);
        }
    } else if (item.type === "path") {
        selectPath(item.name);
    } else {
        selectRiver(item.name);
    }
}

function mouseMoved() {
    // The data may still be loading
    if (!grid) {
        return;
    }
    hoverCell(cellUnderMouse());
}

// Index of the grid cell under the mouse, -1 if the mouse is outside
function cellUnderMouse() {
    if (mouseX < 0 || mouseX >= width || mouseY < 0 || mouseY >= height) {
        return -1;
    }
    let col = min(floor(mouseX / grid.cellW), grid.cols - 1);
    let row = min(floor(mouseY / grid.cellH), grid.rows - 1);
    return row * grid.cols + col;
}

// Previews the path or river of a cell (-1 = no cell). Only redraws when
// the mouse moves onto a different cell.
function hoverCell(cell) {
    if (cell === hoveredCell) {
        return;
    }
    hoveredCell = cell;

    let item = cell === -1 ? null : cellItems[cell];
    hoveredPath = item !== null && item.type === "path" ? item.name : null;
    hoveredRiver = item !== null && item.type === "river" ? item.name : null;

    showPathName();
    showRiverName();
    updateOpacity();
    redraw();
}

// ---------------------------------------------------------------
// Selection
// ---------------------------------------------------------------

// Selects a path by name (null = no path selected). The river stays.
function selectPath(name) {
    if (name === selectedPath) {
        return;
    }
    selectedPath = name;
    pathCell = findCell("path", name);
    showPathName();
    updateOpacity();
    redraw();
}

// Selects a river by name (null = no river selected). The path stays.
function selectRiver(name) {
    if (name === selectedRiver) {
        return;
    }
    selectedRiver = name;
    riverCell = findCell("river", name);
    showRiverName();
    updateOpacity();
    redraw();
}

function findCell(type, name) {
    for (let i = 0; i < cellItems.length; i++) {
        let item = cellItems[i];
        if (item !== null && item.type === type && item.name === name) {
            return i;
        }
    }
    return -1;
}

// The path that is shown: the hovered one, otherwise the selected one
function shownPath() {
    return hoveredPath !== null ? hoveredPath : selectedPath;
}

// The river that is shown: the hovered one, otherwise the selected one
function shownRiver() {
    return hoveredRiver !== null ? hoveredRiver : selectedRiver;
}

function isShownRoad(road) {
    return shownPath() !== null && road.name === shownPath();
}

function isShownRiver(river) {
    return shownRiver() !== null && river.name === shownRiver();
}

// Nothing shown: every line is fully visible.
// Otherwise paths and rivers are handled separately: the shown path is
// fully visible and the other paths fade with their distance to it, the
// same for the shown river and the other rivers. A layer without its
// own shown line stays at its minimum opacity.
function updateOpacity() {
    let nothingShown = shownPath() === null && shownRiver() === null;
    roadOpacity = layerOpacities(
        roadLines, shownPath(), isShownRoad, PATH_FADE_RADIUS, PATH_MIN_OPACITY, nothingShown
    );
    waterOpacity = layerOpacities(
        waterLines, shownRiver(), isShownRiver, WATER_FADE_RADIUS, WATER_MIN_OPACITY, nothingShown
    );
}

function layerOpacities(lines, shownName, isShownLine, radius, minOpacity, nothingShown) {
    if (shownName === null) {
        let result = [];
        for (let line of lines) {
            result.push(nothingShown ? 1 : minOpacity);
        }
        return result;
    }

    // Points of the shown line. Points closer than 3 px to the last kept
    // point are skipped: long rivers have thousands of points and the fade
    // would get slow.
    let shownPoints = [];
    for (let line of lines) {
        if (line.name === shownName) {
            let last = null;
            for (let p of line.points) {
                if (last === null || dist(last[0], last[1], p[0], p[1]) >= 3) {
                    shownPoints.push(p);
                    last = p;
                }
            }
        }
    }
    return fadeOpacities(lines, isShownLine, shownPoints, radius, minOpacity);
}

// Opacity for every line: 1 for the shown one, otherwise it depends on
// the distance from the line's center to the nearest shown point:
// 0 px -> 1 (fully visible), radius or more -> minOpacity.
function fadeOpacities(lines, isShownLine, shownPoints, radius, minOpacity) {
    // Box around the shown points, to skip far away lines quickly
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let p of shownPoints) {
        minX = min(minX, p[0]);
        maxX = max(maxX, p[0]);
        minY = min(minY, p[1]);
        maxY = max(maxY, p[1]);
    }

    let result = [];
    for (let line of lines) {
        if (isShownLine(line)) {
            result.push(1);
            continue;
        }

        if (
            line.cx < minX - radius ||
            line.cx > maxX + radius ||
            line.cy < minY - radius ||
            line.cy > maxY + radius
        ) {
            result.push(minOpacity);
            continue;
        }

        // Squared distances are faster to compare than real distances
        let nearest = Infinity;
        for (let p of shownPoints) {
            let dx = line.cx - p[0];
            let dy = line.cy - p[1];
            nearest = Math.min(nearest, dx * dx + dy * dy);
        }
        let d = Math.sqrt(nearest);
        result.push(map(d, 0, radius, 1, minOpacity, true));
    }
    return result;
}

// ---------------------------------------------------------------
// Search fields with autocomplete
//
// While typing, the field is filled up with the first name that starts
// with the typed text. The added part is highlighted, so typing on simply
// replaces it. Arrow up / down switch to the previous / next fitting name,
// Enter (or leaving the field) takes the name.
// ---------------------------------------------------------------

function makeSearchFields() {
    for (let item of cellItems) {
        if (item === null) {
            continue;
        }
        if (item.type === "path") {
            pathNames.push(item.name);
        } else {
            riverNames.push(item.name);
        }
    }
    pathNames.sort();
    riverNames.sort();

    pathInput = makeSearchField(pathNames, grid.rows - 1, LEFT, "#ffffff", "Search a path …", selectPath);
    riverInput = makeSearchField(riverNames, grid.rows - 1, RIGHT, "#6464ff", "Search a river …", selectRiver);
    riverInput.addClass("river-field");
}

// An <input> over the left (side LEFT) or right (side RIGHT) half of a
// grid row. onPick(name) is called whenever the field shows a name
// (or null when no name fits).
function makeSearchField(names, row, side, textColor, placeholder, onPick) {
    let layout = rowTextLayout(row, side);
    let input = createInput("");
    input.attribute("placeholder", placeholder);
    // No suggestion list from the browser
    input.attribute("autocomplete", "off");
    input.attribute("spellcheck", "false");
    input.addClass("search-field");
    input.position(side === LEFT ? 0 : width / 2, row * grid.cellH);
    input.size(width / 2, grid.cellH);
    input.style("font-size", layout.size + "px");
    input.style("color", textColor);
    input.style("text-align", side === LEFT ? "left" : "right");

    let typed = "";    // what was really typed (without the completed part)
    let matches = [];  // all names that start with it
    let index = -1;    // which of the matches is shown (-1 = none)

    // Puts matches[i] into the field, with the completed part highlighted
    function showMatch(i) {
        index = i;
        let name = matches[i];
        input.value(name);
        input.elt.setSelectionRange(typed.length, name.length);
        onPick(name);
    }

    // Runs after every change of the text by the user
    input.elt.addEventListener("input", function (event) {
        typed = input.value();
        matches = namesStartingWith(typed, names);
        index = -1;

        if (typed === "") {
            onPick(null);
            return;
        }
        // When deleting, do not complete again, otherwise Backspace
        // would bring the deleted letters right back
        if (event.inputType && event.inputType.startsWith("delete")) {
            return;
        }
        if (matches.length > 0) {
            showMatch(0);
        } else {
            onPick(null);
        }
    });

    input.elt.addEventListener("keydown", function (event) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            // Arrows would move the cursor otherwise
            event.preventDefault();
            if (matches.length === 0) {
                return;
            }
            let next = index + (event.key === "ArrowDown" ? 1 : -1);
            if (next < 0) {
                next = matches.length - 1;
            }
            if (next >= matches.length) {
                next = 0;
            }
            showMatch(next);
        } else if (event.key === "Enter") {
            acceptName();
        }
    });

    input.elt.addEventListener("blur", acceptName);

    // Takes the name in the field (or the best fitting one) and puts
    // the cursor behind it
    function acceptName() {
        let match = bestMatch(input.value(), names);
        if (match === null) {
            return;
        }
        typed = match;
        matches = [match];
        index = 0;
        input.value(match);
        input.elt.setSelectionRange(match.length, match.length);
        onPick(match);
    }

    return input;
}

// Shows the shown path in the bottom field, unless someone is typing there
function showPathName() {
    if (document.activeElement !== pathInput.elt) {
        pathInput.value(shownPath() === null ? "" : shownPath());
    }
}

// Shows the shown river in the top field, unless someone is typing there
function showRiverName() {
    if (document.activeElement !== riverInput.elt) {
        riverInput.value(shownRiver() === null ? "" : shownRiver());
    }
}

// All names that start with the typed text (upper/lower case does not matter)
function namesStartingWith(typed, names) {
    let t = typed.toLowerCase();
    let result = [];
    for (let name of names) {
        if (name.toLowerCase().startsWith(t)) {
            result.push(name);
        }
    }
    return result;
}

// Best fitting name for a typed text: exactly the same, otherwise the
// first name that starts with it, otherwise the first that contains it.
// Upper and lower case do not matter. Returns null if nothing fits.
function bestMatch(typed, names) {
    // Some names only differ in upper/lower case ("9a" and "9A")
    if (names.includes(typed)) {
        return typed;
    }
    let t = typed.trim().toLowerCase();
    if (t === "") {
        return null;
    }
    for (let name of names) {
        if (name.toLowerCase() === t) {
            return name;
        }
    }
    for (let name of names) {
        if (name.toLowerCase().startsWith(t)) {
            return name;
        }
    }
    for (let name of names) {
        if (name.toLowerCase().includes(t)) {
            return name;
        }
    }
    return null;
}

// ---------------------------------------------------------------
// Helpers for the geo data
// ---------------------------------------------------------------

function isWalkway(feature) {
    return WALK_TYPES.includes(feature.properties.fclass);
}

// Returns the feature as a list of lines in [longitude, latitude].
// A "LineString" is one line, a "MultiLineString" is several lines.
function geoLinesOf(feature) {
    if (feature.geometry.type === "LineString") {
        return [feature.geometry.coordinates];
    } else if (feature.geometry.type === "MultiLineString") {
        return feature.geometry.coordinates;
    }
    return [];
}

// Returns the feature as a list of lines in screen coordinates.
function projectLines(feature) {
    let result = [];
    for (let geoLine of geoLinesOf(feature)) {
        let line = [];
        for (let point of geoLine) {
            line.push(projection(point));
        }
        result.push(line);
    }
    return result;
}

// One entry for roadLines / waterLines
function makeLine(feature, points) {
    let center = centerOf(points);
    return {
        name: feature.properties.name,
        points: points,
        cx: center[0],
        cy: center[1],
    };
}

// Average position of all points of a line
function centerOf(line) {
    let sumX = 0;
    let sumY = 0;
    for (let p of line) {
        sumX += p[0];
        sumY += p[1];
    }
    return [sumX / line.length, sumY / line.length];
}

// ---------------------------------------------------------------
// Grid with path and river names
// ---------------------------------------------------------------

function makeGridLabels() {
    // 1. Find every walkway name and every river name and the average
    //    position of their points. A name can belong to several features,
    //    so we add them all up.
    //    This uses longitude and latitude directly, because the map
    //    projection is only made after the grid (see setup).
    let byName = new Map();
    for (let feature of roads.features) {
        if (feature.properties.name && isWalkway(feature)) {
            addPosition(byName, "path", feature);
        }
    }
    for (let feature of waterways.features) {
        if (feature.properties.name) {
            addPosition(byName, "river", feature);
        }
    }

    let items = [];
    for (let entry of byName.values()) {
        if (entry.count > 0) {
            items.push({
                type: entry.type,
                name: entry.name,
                lon: entry.sumLon / entry.count,
                lat: entry.sumLat / entry.count,
            });
        }
    }

    // 2. Choose the grid size: enough cells for all names,
    //    with roughly the same shape as the canvas,
    //    plus an empty row at the top and one at the bottom.
    let cols = max(1, ceil(sqrt((items.length * width) / height)));
    let nameRows = max(1, ceil(items.length / cols));
    let rows = nameRows + 2;
    grid = { cols: cols, rows: rows, cellW: width / cols, cellH: height / rows };

    // 3. Sort all names from north to south and cut them into rows.
    //    Then sort every row from west to east.
    //    So the first name row has the northernmost names, and inside
    //    a row the westernmost name is on the left.
    items.sort(function (a, b) {
        return b.lat - a.lat;
    });

    cellItems = new Array(cols * rows).fill(null);
    let textW = grid.cellW - CELL_PADDING * 2;
    let maxLines = max(1, floor((grid.cellH - CELL_PADDING * 2) / LINE_HEIGHT));

    for (let r = 0; r < nameRows; r++) {
        let row = r + 1; // row 0 stays empty
        let rowItems = items.slice(r * cols, (r + 1) * cols);
        rowItems.sort(function (a, b) {
            return a.lon - b.lon;
        });

        for (let i = 0; i < rowItems.length; i++) {
            // A full row uses every column. A shorter last row
            // is spread out evenly instead of bunching up on the left.
            let col = floor((i * cols) / rowItems.length);
            let item = rowItems[i];

            cellItems[row * cols + col] = { type: item.type, name: item.name };
            gridLabels.push({
                x: col * grid.cellW + CELL_PADDING,
                y: row * grid.cellH + CELL_PADDING,
                lines: wrapText(item.name, textW, maxLines),
                type: item.type,
            });
        }
    }
}

// Adds all points of a feature to the entry for its name.
// Paths and rivers are kept apart, even if they have the same name.
function addPosition(byName, type, feature) {
    let name = feature.properties.name;
    let key = type + ":" + name;
    if (!byName.has(key)) {
        byName.set(key, { type: type, name: name, sumLon: 0, sumLat: 0, count: 0 });
    }
    let entry = byName.get(key);
    for (let line of geoLinesOf(feature)) {
        for (let p of line) {
            entry.sumLon += p[0];
            entry.sumLat += p[1];
            entry.count += 1;
        }
    }
}

// Splits a text into lines that are at most maxWidth wide.
function wrapText(txt, maxWidth, maxLines) {
    let words = txt.trim().split(" ");
    let lines = [];
    let line = "";

    for (let word of words) {
        let test = line === "" ? word : line + " " + word;
        if (textWidth(test) <= maxWidth || line === "") {
            line = test;
        } else {
            lines.push(line);
            line = word;
        }
    }
    if (line !== "") {
        lines.push(line);
    }

    lines = lines.slice(0, maxLines);

    // A single long word can still be too wide: cut it off
    for (let i = 0; i < lines.length; i++) {
        while (lines[i].length > 1 && textWidth(lines[i]) > maxWidth) {
            lines[i] = lines[i].slice(0, -1);
        }
    }
    return lines;
}

// ---------------------------------------------------------------
// River names on the map (placed so they do not overlap)
// ---------------------------------------------------------------

function makeWaterLabels() {
    let usedBoxes = [];

    for (let feature of waterways.features) {
        let name = feature.properties.name;
        if (!name) {
            continue;
        }

        // "Etsch - Adige" becomes two lines
        let lines = name.split(" - ");
        let w = 0;
        for (let line of lines) {
            w = max(w, textWidth(line));
        }
        let h = lines.length * LINE_HEIGHT;

        let points = [];
        for (let line of projectLines(feature)) {
            for (let p of line) {
                points.push(p);
            }
        }
        if (points.length === 0) {
            continue;
        }

        let spot = findFreeSpot(points, w, h, usedBoxes);
        if (spot) {
            waterLabels.push({ x: spot.x, y: spot.y, lines: lines });
        }
    }
}

// Tries a few positions along the river (start, 1/4, middle, 3/4, end),
// each with small offsets, and returns the first one that is free.
function findFreeSpot(points, w, h, usedBoxes) {
    for (let t of [0, 0.25, 0.5, 0.75, 1]) {
        let p = points[floor(t * (points.length - 1))];

        for (let dy of [0, 6, -6, 12, -12]) {
            for (let dx of [0, 8, -8, 14, -14]) {
                let x = p[0] + dx;
                let y = p[1] + dy;

                // Stay inside the canvas and out of the empty top and bottom row
                if (x < 0 || x + w > width || y < grid.cellH || y + h > height - grid.cellH) {
                    continue;
                }

                let box = {
                    x: x - LABEL_MARGIN,
                    y: y - LABEL_MARGIN,
                    w: w + LABEL_MARGIN * 2,
                    h: h + LABEL_MARGIN * 2,
                };
                if (!overlapsAny(box, usedBoxes)) {
                    usedBoxes.push(box);
                    return { x: x, y: y };
                }
            }
        }
    }
    return null;
}

function overlapsAny(box, boxes) {
    for (let other of boxes) {
        if (
            box.x < other.x + other.w &&
            box.x + box.w > other.x &&
            box.y < other.y + other.h &&
            box.y + box.h > other.y
        ) {
            return true;
        }
    }
    return false;
}

// ---------------------------------------------------------------
// Drawing on the canvas
// ---------------------------------------------------------------

// Draws the whole map (grid, names, all lines) once into a picture.
// pathOpacity / waterOpacity: how visible the walkways / rivers are.
function makePicture(pathOpacity, waterOpacity) {
    let g = createGraphics(width, height);
    g.canvas.classList.add("map-picture");
    g.background(0);

    // Grid cells (the top and bottom row stay empty)
    g.noFill();
    g.stroke(32);
    g.strokeWeight(0.5);
    for (let row = 1; row < grid.rows - 1; row++) {
        for (let col = 0; col < grid.cols; col++) {
            g.rect(col * grid.cellW, row * grid.cellH, grid.cellW, grid.cellH);
        }
    }

    // Names inside the grid: paths grey, rivers blue
    g.noStroke();
    g.textFont(font);
    g.textSize(TEXT_SIZE);
    g.textAlign(LEFT, TOP);
    for (let label of gridLabels) {
        if (label.type === "river") {
            g.fill(100, 100, 255);
        } else {
            g.fill(180);
        }
        drawLabel(g, label);
    }

    // Walkways and rivers
    g.noFill();
    g.strokeWeight(0.5);
    g.stroke(255, pathOpacity * 255);
    for (let road of roadLines) {
        drawLine(g.drawingContext, road.points);
    }
    g.stroke(100, 100, 255, waterOpacity * 255);
    for (let river of waterLines) {
        drawLine(g.drawingContext, river.points);
    }

    // River names on the map
    if (SHOW_WATER_LABELS) {
        g.noStroke();
        g.fill(100, 100, 255);
        for (let label of waterLabels) {
            drawLabel(g, label);
        }
    }
    return g;
}

function showPicture(picture, visible) {
    picture.canvas.style.display = visible ? "block" : "none";
}

// Draws the lines that are more visible than in dimPicture on top of it.
// They are already there with minOpacity, so only the missing part is
// added: drawing (opacity - min) / (1 - min) on top gives the opacity.
function drawHighlights(lines, opacities, minOpacity, isShownLine, rgb) {
    for (let i = 0; i < lines.length; i++) {
        if (opacities[i] <= minOpacity) {
            continue;
        }
        let extra = (opacities[i] - minOpacity) / (1 - minOpacity);
        stroke(rgb[0], rgb[1], rgb[2], extra * 255);
        strokeWeight(isShownLine(lines[i]) ? 1.5 : 0.5);
        drawLine(drawingContext, lines[i].points);
    }
}

function drawCellFrame(cell) {
    let col = cell % grid.cols;
    let row = floor(cell / grid.cols);
    rect(col * grid.cellW, row * grid.cellH, grid.cellW, grid.cellH);
}

// Draws with the canvas functions directly (ctx = drawingContext of the
// canvas or a picture, colour and weight as set with stroke() and
// strokeWeight()): beginShape() / vertex() are much slower
function drawLine(ctx, points) {
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let p of points) {
        ctx.lineTo(p[0], p[1]);
    }
    ctx.stroke();
}

function drawLabel(g, label) {
    for (let i = 0; i < label.lines.length; i++) {
        g.text(label.lines[i], label.x, label.y + i * LINE_HEIGHT);
    }
}

// Text size and position so the letters (including the parts
// below the line, like in g, p, y) fill the row from top to bottom.
// Used for the search fields and the SVG export.
function rowTextLayout(row, side) {
    // p5 measures ascent/descent from the current vertical alignment,
    // so it has to be BASELINE here
    textAlign(side, BASELINE);

    // Measure how tall the font is at size 100, then scale to the row height
    textSize(100);
    let size = (grid.cellH * 100) / (textAscent() + textDescent());

    textSize(size);
    let baseline = (row + 1) * grid.cellH - textDescent();
    let x = side === LEFT ? 0 : width;
    return { size: size, x: x, y: baseline };
}

// ---------------------------------------------------------------
// SVG export (same layers and colors as draw())
// ---------------------------------------------------------------

function saveSvg() {
    let svg = [];
    svg.push(`<?xml version="1.0" encoding="UTF-8"?>`);
    svg.push(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    );
    svg.push(`<rect width="${width}" height="${height}" fill="#000000"/>`);

    svg.push(`<g stroke="#202020" stroke-width="0.5" fill="none">`);
    for (let row = 1; row < grid.rows - 1; row++) {
        for (let col = 0; col < grid.cols; col++) {
            svg.push(
                `<rect x="${col * grid.cellW}" y="${row * grid.cellH}" width="${grid.cellW}" height="${grid.cellH}"/>`
            );
        }
    }
    svg.push(`</g>`);

    for (let cell of [pathCell, riverCell]) {
        if (cell !== -1) {
            let col = cell % grid.cols;
            let row = floor(cell / grid.cols);
            svg.push(
                `<rect x="${col * grid.cellW}" y="${row * grid.cellH}" width="${grid.cellW}" height="${grid.cellH}" stroke="#ffffff" stroke-width="0.5" fill="none"/>`
            );
        }
    }

    svgAddLabels(svg, gridLabels.filter((label) => label.type === "path"), "#b4b4b4");
    svgAddLabels(svg, gridLabels.filter((label) => label.type === "river"), "#6464ff");

    svg.push(
        `<g fill="none" stroke="#ffffff" stroke-width="0.5" stroke-linecap="round" stroke-linejoin="round">`
    );
    for (let i = 0; i < roadLines.length; i++) {
        let road = roadLines[i];
        let extra = `stroke-opacity="${roadOpacity[i].toFixed(2)}"`;
        if (isShownRoad(road)) {
            extra += ` stroke-width="1.5"`;
        }
        svg.push(svgPolyline(road.points, extra));
    }
    svg.push(`</g>`);

    svg.push(
        `<g fill="none" stroke="#6464ff" stroke-width="0.5" stroke-linecap="round" stroke-linejoin="round">`
    );
    for (let i = 0; i < waterLines.length; i++) {
        let river = waterLines[i];
        let extra = `stroke-opacity="${waterOpacity[i].toFixed(2)}"`;
        if (isShownRiver(river)) {
            extra += ` stroke-width="1.5"`;
        }
        svg.push(svgPolyline(river.points, extra));
    }

    svg.push(`</g>`);

    if (SHOW_WATER_LABELS) {
        svgAddLabels(svg, waterLabels, "#6464ff");
    }

    if (shownPath() !== null) {
        svgAddRowText(svg, shownPath(), grid.rows - 1, LEFT, "#ffffff");
    }
    if (shownRiver() !== null) {
        svgAddRowText(svg, shownRiver(), grid.rows - 1, RIGHT, "#6464ff");
    }

    svg.push(`</svg>`);

    saveStrings(svg, "suedtirol-wege", "svg");
}

function svgPolyline(points, extraAttributes) {
    let pointText = "";
    for (let p of points) {
        pointText += p[0].toFixed(2) + "," + p[1].toFixed(2) + " ";
    }
    return `<polyline points="${pointText.trim()}" ${extraAttributes}/>`;
}

function svgAddLabels(svg, labels, color) {
    svg.push(`<g fill="${color}" font-size="${TEXT_SIZE}" font-family="${SVG_FONT_FAMILY}">`);
    for (let label of labels) {
        for (let i = 0; i < label.lines.length; i++) {
            let y = label.y + i * LINE_HEIGHT;
            svg.push(
                `<text x="${label.x}" y="${y}" dominant-baseline="hanging">${escapeXml(label.lines[i])}</text>`
            );
        }
    }
    svg.push(`</g>`);
}

function svgAddRowText(svg, name, row, side, textColor) {
    let layout = rowTextLayout(row, side);
    let anchor = side === LEFT ? "start" : "end";
    svg.push(
        `<text x="${layout.x}" y="${layout.y}" fill="${textColor}" font-size="${layout.size}" font-family="${SVG_FONT_FAMILY}" text-anchor="${anchor}">${escapeXml(name)}</text>`
    );
}

// Characters like & or < would break the SVG file
function escapeXml(str) {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}
