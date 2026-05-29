// ==========================================================================
// Ignis Arc Workbench - Premium JS Theme Engine
// ==========================================================================

// --- Presets Data ---
const PRESETS = {
  obsidian: {
    themeName: "Ignis Arc Obsidian Dark",
    bg: "#0C0E12",
    fg: "#E2E8F0",
    cursor: "#FA9E42",
    select: "#E24A35",
    activityBg: "#07080B",
    sidebarBg: "#090B0E",
    statusbarBg: "#07080B",
    accent: "#E24A35",
    keyword: "#E24A35",
    control: "#FA9E42",
    class: "#B794F4",
    method: "#63B3ED",
    string: "#38B2AC",
    variable: "#CBD5E0",
    constant: "#ED64A6",
    comment: "#64748B",
    annotation: "#FA9E42"
  },
  pastel: {
    themeName: "Ignis Arc Pastel Dream",
    bg: "#1E1B29",
    fg: "#E6E6FA",
    cursor: "#FFA07A",
    select: "#FFB7C5",
    activityBg: "#15131E",
    sidebarBg: "#1A1725",
    statusbarBg: "#15131E",
    accent: "#FF8E72",
    keyword: "#FF8E72",
    control: "#FFA07A",
    class: "#FFB7C5",
    method: "#90CAF9",
    string: "#FFF59D",
    variable: "#B4BEFE",
    constant: "#F5C2E7",
    comment: "#6C7086",
    annotation: "#F9E2AF"
  }
};

// --- DOM Elements Mappings ---
const FIELDS = {
  bg: { picker: "color-bg", text: "text-bg", cssVar: "--editor-bg" },
  fg: { picker: "color-fg", text: "text-fg", cssVar: "--editor-fg" },
  cursor: { picker: "color-cursor", text: "text-cursor", cssVar: "--editor-cursor" },
  select: { picker: "color-select", text: "text-select", cssVar: "--editor-select", opacity: "33" },
  activityBg: { picker: "color-activity-bg", text: "text-activity-bg", cssVar: "--activity-bg" },
  sidebarBg: { picker: "color-sidebar-bg", text: "text-sidebar-bg", cssVar: "--sidebar-bg" },
  statusbarBg: { picker: "color-statusbar-bg", text: "text-statusbar-bg", cssVar: "--statusbar-bg" },
  accent: { picker: "color-accent", text: "text-accent", cssVar: "--accent-color" },
  keyword: { picker: "color-keyword", text: "text-keyword", cssVar: "--token-keyword" },
  control: { picker: "color-control", text: "text-control", cssVar: "--token-control" },
  class: { picker: "color-class", text: "text-class", cssVar: "--token-class" },
  method: { picker: "color-method", text: "text-method", cssVar: "--token-method" },
  string: { picker: "color-string", text: "text-string", cssVar: "--token-string" },
  variable: { picker: "color-variable", text: "text-variable", cssVar: "--token-variable" },
  constant: { picker: "color-constant", text: "text-constant", cssVar: "--token-constant" },
  comment: { picker: "color-comment", text: "text-comment", cssVar: "--token-comment" },
  annotation: { picker: "color-annotation", text: "text-annotation", cssVar: "--token-annotation" }
};

// --- Initialization ---
document.addEventListener("DOMContentLoaded", () => {
  setupEventListeners();
  loadPreset("obsidian"); // Load default theme on start
});

// --- Setup Event Listeners ---
function setupEventListeners() {
  // Preset Select Listener
  const presetSelect = document.getElementById("preset-select");
  presetSelect.addEventListener("change", (e) => {
    loadPreset(e.target.value);
  });

  // Color Pickers & Hex Text Fields Linkage
  Object.keys(FIELDS).forEach(key => {
    const config = FIELDS[key];
    const picker = document.getElementById(config.picker);
    const text = document.getElementById(config.text);

    // Sync: Picker -> Text Input -> CSS Custom Properties -> JSON Compile
    picker.addEventListener("input", (e) => {
      let hex = e.target.value.toUpperCase();
      if (config.opacity) {
        text.value = hex + config.opacity;
        updateCssVariable(config.cssVar, hex + config.opacity);
      } else {
        text.value = hex;
        updateCssVariable(config.cssVar, hex);
      }
      compileThemeJSON();
    });

    // Sync: Text Input -> Picker -> CSS Custom Properties -> JSON Compile
    text.addEventListener("input", (e) => {
      let hex = e.target.value.trim();
      if (isValidHex(hex)) {
        let cleanHex = hex.substring(0, 7); // Strip alpha if present for the standard input picker
        picker.value = cleanHex;
        updateCssVariable(config.cssVar, hex);
        compileThemeJSON();
      }
    });
  });
}

// --- Load Preset Theme ---
function loadPreset(presetKey) {
  const data = PRESETS[presetKey];
  if (!data) return;

  // Update footer-right / UI metadata label
  const themeNameLabel = document.querySelector(".theme-name");
  if (themeNameLabel) {
    themeNameLabel.textContent = data.themeName;
  }

  // Load each key
  Object.keys(FIELDS).forEach(key => {
    const config = FIELDS[key];
    const baseColor = data[key];
    const picker = document.getElementById(config.picker);
    const text = document.getElementById(config.text);

    picker.value = baseColor;
    if (config.opacity) {
      text.value = baseColor.toUpperCase() + config.opacity;
      updateCssVariable(config.cssVar, baseColor + config.opacity);
    } else {
      text.value = baseColor.toUpperCase();
      updateCssVariable(config.cssVar, baseColor);
    }
  });

  compileThemeJSON();
}

// --- Helper Functions ---
function updateCssVariable(cssVarName, value) {
  document.documentElement.style.setProperty(cssVarName, value);
}

function isValidHex(hex) {
  return /^#[0-9A-F]{6}([0-9A-F]{2})?$/i.test(hex);
}

// --- Switch Control Tabs ---
function switchSettingsTab(tabId) {
  // Toggle tab buttons active class
  const buttons = document.querySelectorAll(".setting-tab-btn");
  buttons.forEach(btn => {
    btn.classList.remove("active");
    if (btn.getAttribute("onclick").includes(tabId)) {
      btn.classList.add("active");
    }
  });

  // Toggle settings content panes active class
  const contents = document.querySelectorAll(".setting-tab-content");
  contents.forEach(content => {
    content.classList.remove("active");
  });
  document.getElementById(tabId).classList.add("active");
}

// --- Compile Theme JSON ---
function compileThemeJSON() {
  const getVal = (key) => document.getElementById(FIELDS[key].text).value;
  
  const presetSelect = document.getElementById("preset-select");
  const activePreset = presetSelect.value;
  const displayName = PRESETS[activePreset].themeName;

  const themeJson = {
    "name": displayName,
    "type": "dark",
    "colors": {
      "editor.background": getVal("bg"),
      "editor.foreground": getVal("fg"),
      "editor.lineHighlightBackground": getVal("bg") === "#0C0E12" ? "#171A21" : "#1A202C",
      "editor.selectionBackground": getVal("select"),
      "editor.inactiveSelectionBackground": getVal("select").substring(0, 7) + "1E",
      "editorCursor.foreground": getVal("cursor"),
      "editorWhitespace.foreground": "#2D3748",
      "editorLineNumber.foreground": "#4A5568",
      "editorLineNumber.activeForeground": getVal("cursor"),
      "editorWidget.background": getVal("sidebarBg"),
      "editorWidget.border": "#1A202C",

      "activityBar.background": getVal("activityBg"),
      "activityBar.foreground": getVal("cursor"),
      "activityBar.inactiveForeground": "#4A5568",
      "activityBar.border": getVal("bg"),
      "activityBarBadge.background": getVal("accent"),
      "activityBarBadge.foreground": "#FFFFFF",

      "sideBar.background": getVal("sidebarBg"),
      "sideBar.foreground": "#CBD5E0",
      "sideBar.border": getVal("bg"),
      "sideBarTitle.foreground": getVal("cursor"),
      "sideBarSectionHeader.background": getVal("bg"),
      "sideBarSectionHeader.foreground": "#E2E8F0",

      "statusBar.background": getVal("activityBg"),
      "statusBar.foreground": "#CBD5E0",
      "statusBar.border": getVal("bg"),
      "statusBarItem.activeBackground": getVal("accent") + "33",

      "titleBar.activeBackground": getVal("activityBg"),
      "titleBar.activeForeground": "#E2E8F0",
      "titleBar.border": getVal("bg"),

      "tab.activeBackground": getVal("bg"),
      "tab.activeForeground": getVal("cursor"),
      "tab.inactiveBackground": getVal("sidebarBg"),
      "tab.inactiveForeground": "#718096",
      "tab.border": getVal("activityBg"),
      "tab.activeBorderTop": getVal("accent"),

      "list.activeSelectionBackground": getVal("accent") + "2A",
      "list.activeSelectionForeground": getVal("cursor"),
      "list.inactiveSelectionBackground": "#1A202C",
      "list.inactiveSelectionForeground": "#E2E8F0",
      "list.hoverBackground": "#171A21",
      "list.hoverForeground": "#E2E8F0",
      "list.focusBackground": getVal("accent") + "33",
      "list.focusForeground": getVal("cursor"),

      "button.background": getVal("accent"),
      "button.foreground": "#FFFFFF",
      "button.hoverBackground": getVal("accent"),

      "input.background": "#12161A",
      "input.foreground": "#E2E8F0",
      "input.border": "#1A202C",

      "terminal.background": getVal("sidebarBg"),
      "terminal.foreground": "#CBD5E0",
      "terminalCursor.foreground": getVal("cursor")
    },
    "tokenColors": [
      {
        "scope": [
          "comment",
          "punctuation.definition.comment"
        ],
        "settings": {
          "foreground": getVal("comment"),
          "fontStyle": "italic"
        }
      },
      {
        "scope": [
          "keyword",
          "storage.type",
          "storage.modifier"
        ],
        "settings": {
          "foreground": getVal("keyword"),
          "fontStyle": "bold"
        }
      },
      {
        "scope": [
          "keyword.control",
          "keyword.control.flow"
        ],
        "settings": {
          "foreground": getVal("control")
        }
      },
      {
        "scope": [
          "string",
          "punctuation.definition.string"
        ],
        "settings": {
          "foreground": getVal("string")
        }
      },
      {
        "scope": [
          "entity.name.type",
          "entity.name.class",
          "support.class",
          "storage.type.java",
          "storage.type.object.array.java"
        ],
        "settings": {
          "foreground": getVal("class")
        }
      },
      {
        "scope": [
          "entity.name.function",
          "support.function",
          "variable.function",
          "meta.method-call.java"
        ],
        "settings": {
          "foreground": getVal("method")
        }
      },
      {
        "scope": [
          "variable",
          "variable.parameter",
          "variable.other"
        ],
        "settings": {
          "foreground": getVal("variable")
        }
      },
      {
        "scope": [
          "variable.other.property",
          "variable.other.object.property"
        ],
        "settings": {
          "foreground": getVal("fg")
        }
      },
      {
        "scope": [
          "constant.numeric",
          "constant.language",
          "constant.character",
          "constant.other"
        ],
        "settings": {
          "foreground": getVal("constant")
        }
      },
      {
        "scope": [
          "meta.declaration.annotation.java",
          "storage.type.annotation.java"
        ],
        "settings": {
          "foreground": getVal("annotation"),
          "fontStyle": "italic"
        }
      },
      {
        "scope": [
          "punctuation",
          "meta.brace",
          "punctuation.separator",
          "punctuation.terminator"
        ],
        "settings": {
          "foreground": "#A0AEC0"
        }
      },
      {
        "scope": [
          "markup.heading",
          "entity.name.section.markdown",
          "punctuation.definition.heading.markdown"
        ],
        "settings": {
          "foreground": getVal("keyword"),
          "fontStyle": "bold"
        }
      },
      {
        "scope": [
          "markup.bold",
          "punctuation.definition.bold.markdown"
        ],
        "settings": {
          "foreground": getVal("control"),
          "fontStyle": "bold"
        }
      },
      {
        "scope": [
          "markup.italic",
          "punctuation.definition.italic.markdown"
        ],
        "settings": {
          "foreground": getVal("class"),
          "fontStyle": "italic"
        }
      },
      {
        "scope": [
          "markup.inline.raw",
          "markup.raw.inline.markdown"
        ],
        "settings": {
          "foreground": getVal("string")
        }
      },
      {
        "scope": [
          "markup.underline.link",
          "string.other.link.title.markdown"
        ],
        "settings": {
          "foreground": getVal("method"),
          "fontStyle": "underline"
        }
      },
      {
        "scope": [
          "markup.list",
          "punctuation.definition.list_item.markdown"
        ],
        "settings": {
          "foreground": getVal("control")
        }
      },
      {
        "scope": [
          "markup.quote",
          "punctuation.definition.quote.markdown"
        ],
        "settings": {
          "foreground": getVal("comment"),
          "fontStyle": "italic"
        }
      },
      {
        "scope": [
          "entity.name.tag",
          "meta.tag.sgml"
        ],
        "settings": {
          "foreground": getVal("keyword")
        }
      },
      {
        "scope": [
          "entity.other.attribute-name",
          "meta.attribute.java"
        ],
        "settings": {
          "foreground": getVal("control")
        }
      },
      {
        "scope": [
          "support.type.property-name.json",
          "string.json"
        ],
        "settings": {
          "foreground": getVal("class")
        }
      },
      {
        "scope": "meta.structure.dictionary.value.json string.json",
        "settings": {
          "foreground": getVal("string")
        }
      },
      {
        "scope": [
          "entity.name.tag.css",
          "entity.other.attribute-name.class.css",
          "entity.other.attribute-name.id.css"
        ],
        "settings": {
          "foreground": getVal("keyword"),
          "fontStyle": "bold"
        }
      },
      {
        "scope": [
          "support.type.property-name.css",
          "meta.property-name.scss"
        ],
        "settings": {
          "foreground": getVal("control")
        }
      },
      {
        "scope": [
          "support.constant.property-value.css",
          "support.constant.color.w3c-standard-color-name.css"
        ],
        "settings": {
          "foreground": getVal("string")
        }
      },
      {
        "scope": [
          "entity.name.tag.yaml"
        ],
        "settings": {
          "foreground": getVal("class"),
          "fontStyle": "bold"
        }
      }
    ]
  };

  document.getElementById("json-preview").value = JSON.stringify(themeJson, null, 2);
}

// --- Download Theme JSON File ---
function downloadThemeJSON() {
  const jsonPreview = document.getElementById("json-preview").value;
  const blob = new Blob([jsonPreview], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "ignis-arc-obsidian.json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// --- Copy JSON to Clipboard ---
function copyThemeJSON() {
  const jsonPreview = document.getElementById("json-preview");
  jsonPreview.select();
  document.execCommand("copy");
  
  // Custom subtle alert feedback
  const originalVal = jsonPreview.value;
  jsonPreview.value = "✓ Theme JSON copied successfully to your clipboard! Paste directly into themes/ignis-arc-obsidian.json";
  setTimeout(() => {
    jsonPreview.value = originalVal;
  }, 2500);
}
