// ==UserScript==
// @name         Torn UI Components
// @namespace    http://tampermonkey.net/
// @version      1.2.2
// @description  Shared UI components for Torn scripts
// @author       Specker [3313059]
// @copyright    2025 Specker
// @match        https://www.torn.com/*
// @exclude      https://www.torn.com/api.html
// @exclude      https://www.torn.com/swagger.php
// @icon         https://www.google.com/s2/favicons?sz=64&domain=torn.com
// @downloadURL  https://github.com/Specker/Torn-Scripts/raw/refs/heads/main/torn-ui-components.user.js
// @updateURL    https://github.com/Specker/Torn-Scripts/raw/refs/heads/main/torn-ui-components.user.js
// ==/UserScript==

(function () {
  "use strict";

  function createStyledInput(type, value, extraProps = {}) {
    const input = document.createElement("input");
    input.type = type;
    if (value !== undefined) input.value = value;
    input.classList.add("torn-input-style");
    Object.assign(input, extraProps);
    return input;
  }

  const STORAGE_TORN_ITEMS_KEY = "tornItemsCache";

  window.TornUI = {
    ensureDockContainer,
    updateDockColumns,

    createScriptContainer,
    createHeader,
    createIconButton,

    createTable,

    createStyledSelect,

    getDockGroupMembers,

    fetchItemsList,
    createSearchableDropdown,

    getCommonStyles,

    createListContainer,
    createStatusFooter,
    createStyledInput,
  };

  const __torn_ui_item_cache = {};

  function fetchItemsList(
    url = "https://n8n.speckur.quest/webhook/torn/get_items",
    cb,
    opts = {}
  ) {
    const TTL_MS =
      typeof opts.ttlMs === "number" ? opts.ttlMs : 24 * 60 * 60 * 1000;

    try {
      const raw = localStorage.getItem(STORAGE_TORN_ITEMS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.ts && Array.isArray(parsed.items)) {
          const age = Date.now() - parsed.ts;
          if (age <= TTL_MS) {
            __torn_ui_item_cache[url] = {
              loaded: true,
              items: parsed.items,
              queue: [],
              inflight: false,
            };
            try {
              return cb(parsed.items || []);
            } catch (e) {
              return;
            }
          }
        }
      }
    } catch (e) {}

    if (__torn_ui_item_cache[url] && __torn_ui_item_cache[url].loaded) {
      return cb(__torn_ui_item_cache[url].items || []);
    }

    if (!__torn_ui_item_cache[url]) {
      __torn_ui_item_cache[url] = { loaded: false, items: [], queue: [] };
    }
    __torn_ui_item_cache[url].queue.push(cb);
    if (__torn_ui_item_cache[url].inflight) return;
    __torn_ui_item_cache[url].inflight = true;

    const finish = (items) => {
      __torn_ui_item_cache[url].items = items || [];
      __torn_ui_item_cache[url].loaded = true;
      __torn_ui_item_cache[url].inflight = false;
      const q = __torn_ui_item_cache[url].queue || [];
      q.forEach((f) => f(__torn_ui_item_cache[url].items));
      __torn_ui_item_cache[url].queue = [];

      try {
        const payload = JSON.stringify({
          ts: Date.now(),
          items: __torn_ui_item_cache[url].items,
        });
        localStorage.setItem(lsKey, payload);
      } catch (e) {}
    };

    if (typeof GM_xmlhttpRequest === "function") {
      try {
        GM_xmlhttpRequest({
          method: "GET",
          url,
          onload: function (response) {
            try {
              const data = JSON.parse(response.responseText);
              finish(data.items || []);
            } catch (e) {
              finish([]);
            }
          },
          onerror: function () {
            finish([]);
          },
        });
        return;
      } catch (e) {}
    }

    fetch(url)
      .then((r) => r.json())
      .then((data) => finish(data.items || []))
      .catch(() => finish([]));
  }

  function createSearchableDropdown(selectedId, onChange) {
    const fetchUrl = "https://n8n.speckur.quest/webhook/torn/get_items";
    const wrapper = document.createElement("div");
    wrapper.className = "torn-dropdown-wrapper";
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Search item...";
    input.className = "torn-input-style torn-dropdown-input";
    input.autocomplete = "off";
    const dropdown = document.createElement("div");
    dropdown.className = "torn-dropdown-list";
    dropdown.style.display = "none";
    let currentItems = [];
    let selectedItem = null;

    function renderDropdown(filter) {
      dropdown.innerHTML = "";
      const q = (filter || "").toLowerCase();
      const filtered = currentItems.filter(
        (item) =>
          item.name.toLowerCase().includes(q) || String(item.id) === filter
      );
      if (!filtered.length) {
        const noRes = document.createElement("div");
        noRes.textContent = "No results";
        noRes.style.padding = "4px";
        dropdown.appendChild(noRes);
      } else {
        filtered.forEach((item) => {
          const opt = document.createElement("div");
          opt.textContent = `${item.name} [${item.id}]`;
          opt.style.padding = "4px";
          opt.style.cursor = "pointer";
          if (selectedId == item.id) opt.style.background = "#444";
          opt.onclick = () => {
            selectedItem = item;
            input.value = `${item.name} [${item.id}]`;
            dropdown.style.display = "none";
            if (typeof onChange === "function") onChange(item.id);
          };
          dropdown.appendChild(opt);
        });
      }
      dropdown.style.display = "block";
    }

    input.onfocus = () => {
      renderDropdown(input.value);
    };
    input.oninput = () => {
      renderDropdown(input.value);
    };
    input.onblur = () => {
      setTimeout(() => {
        dropdown.style.display = "none";
      }, 200);
    };
    wrapper.appendChild(input);
    wrapper.appendChild(dropdown);

    try {
      const raw = localStorage.getItem(STORAGE_TORN_ITEMS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.items)) {
          currentItems = parsed.items;
          if (selectedId) {
            const found = currentItems.find((i) => i.id == selectedId);
            if (found) input.value = `${found.name} [${found.id}]`;
          }
        }
      }
    } catch (e) {}

    fetchItemsList(fetchUrl, (items) => {
      currentItems = items || [];
      if (selectedId) {
        const found = items.find((i) => i.id == selectedId);
        if (found) {
          input.value = `${found.name} [${found.id}]`;
        }
      }
    });
    return wrapper;
  }

  function ensureDockContainer(position = "left") {
    const dockId =
      position === "right" ? "torn-scripts-dock-right" : "torn-scripts-dock";
    let dock = document.getElementById(dockId);
    if (!dock) {
      dock = document.createElement("div");
      dock.id = dockId;
      dock.style["position"] = "fixed";
      dock.style["top"] = "80px";
      if (position === "right") {
        dock.style["right"] = "10px";
        dock.style["left"] = "";
      } else {
        dock.style["left"] = "10px";
        dock.style["right"] = "";
      }
      dock.style["zIndex"] = "1000";
      dock.style["display"] = "grid";
      dock.style["grid-template-columns"] = "minmax(260px, 1fr)";
      dock.style["gap"] = "10px";
      dock.style["align-items"] = "start";
      dock.style["pointer-events"] = "auto";
      dock.style["height"] = "100%";
      dock.style["overflow"] = "auto";
      document.body.appendChild(dock);
      try {
        if (position === "right") {
          window.__tornScriptsDockRight = dock;
        } else {
          window.__tornScriptsDock = dock;
        }
      } catch (_) {}
      setupDockCollapseManager(dock, position);
    }
    updateDockColumns(dock);
    return dock;
  }

  function setupDockCollapseManager(dock, position = "left") {
    if (dock.__collapseManagerSetup) return;
    dock.__collapseManagerSetup = true;

    function updateCollapseState() {
      if (window.innerWidth > 1920) {
        Array.from(dock.children).forEach((child) => {
          child.classList.remove("torn-script-collapsed");
          child.classList.add("torn-script-expanded");
        });
      } else {
        let expanded = Array.from(dock.children).find((child) =>
          child.classList.contains("torn-script-expanded")
        );
        if (!expanded && dock.children.length > 0) {
          dock.children[0].classList.add("torn-script-expanded");
        }
        Array.from(dock.children).forEach((child) => {
          if (!child.classList.contains("torn-script-expanded")) {
            child.classList.remove("torn-script-expanded");
            child.classList.add("torn-script-collapsed");
          } else {
            child.classList.remove("torn-script-collapsed");
          }
        });
      }
    }

    dock.addEventListener("click", function (e) {
      if (window.innerWidth > 1920) return;
      let header = e.target.closest(".header-wrapper");
      if (!header) return;
      let container = header.parentElement;
      if (!container.classList.contains("torn-script-collapsed")) return;

      Array.from(dock.children).forEach((child) => {
        child.classList.remove("torn-script-expanded");
        child.classList.add("torn-script-collapsed");
      });
      container.classList.remove("torn-script-collapsed");
      container.classList.add("torn-script-expanded");
    });

    window.addEventListener("resize", updateCollapseState);

    setTimeout(() => {
      if (window.innerWidth <= 1920) {
        const children = Array.from(dock.children);
        children.forEach((child, idx) => {
          if (idx === 0) {
            child.classList.add("torn-script-expanded");
            child.classList.remove("torn-script-collapsed");
          } else {
            child.classList.remove("torn-script-expanded");
            child.classList.add("torn-script-collapsed");
          }
        });
      } else {
        updateCollapseState();
      }
    }, 0);
  }

  function updateDockColumns(dock) {
    const scriptCount = dock.children.length;
    if (scriptCount >= 2) {
      dock.style["grid-template-columns"] = "repeat(2, minmax(260px, 1fr))";
    } else {
      dock.style["grid-template-columns"] = "minmax(260px, 1fr)";
    }
  }

  function createScriptContainer(options = {}) {
    let {
      title = "Script",
      iconUrl = null,
      iconTitle = null,
      iconOnClick = null,
      minWidth = "300px",
      maxWidth = "300px",
      showRefreshButton = false,
      refreshOnClick = null,
      showSettingsButton = false,
      settingsOnClick = null,
      showStatusFooter = false,
      statusText = "Ready",
      dockPosition = "left",
      group = null,
    } = options;

    // If dock is on the right, set maxWidth to 420px
    if (dockPosition === "right") {
      maxWidth = "420px";
    }

    let container = document.createElement("div");
    container.classList.add("torn-script-expanded");
    container.style["position"] = "static";
    container.style["zIndex"] = "1";
    container.style["min-width"] = minWidth;
    container.style["max-width"] = maxWidth;

    let header = createHeader(title, {
      iconUrl,
      iconTitle,
      iconOnClick,
      showRefreshButton,
      refreshOnClick,
      showSettingsButton,
      settingsOnClick,
    });
    container.appendChild(header);

    let listContainer = createListContainer();
    container.appendChild(listContainer);

    if (showStatusFooter) {
      let statusFooter = createStatusFooter(statusText);
      container.appendChild(statusFooter);
    }

    const dock = ensureDockContainer(dockPosition);
    container.style["width"] = "auto";
    container.style["max-width"] = maxWidth;
    container.style["box-sizing"] = "border-box";

    // If a group is provided, mark the container and insert it next to other group members
    if (group) {
      container.setAttribute("data-torn-group", String(group));
      // find the last child with the same group
      const same = Array.from(dock.children).filter(
        (c) => c.getAttribute("data-torn-group") === String(group)
      );
      if (same.length) {
        const last = same[same.length - 1];
        if (last.nextSibling) {
          dock.insertBefore(container, last.nextSibling);
        } else {
          dock.appendChild(container);
        }
      } else {
        dock.appendChild(container);
      }
    } else {
      dock.appendChild(container);
    }
    updateDockColumns(dock);

    return {
      container,
      listContainer,
      statusFooter: showStatusFooter
        ? container.querySelector(".torn-script-status-footer")
        : null,
    };
  }

  function createHeader(title, options = {}) {
    const {
      iconUrl = null,
      iconTitle = null,
      iconOnClick = null,
      showRefreshButton = false,
      refreshOnClick = null,
      showSettingsButton = false,
      settingsOnClick = null,
    } = options;

    let header = document.createElement("div");
    header.className = "header-wrapper torn-header";

    let titleElement = document.createElement("h2");
    titleElement.textContent = title;
    titleElement.className = "torn-title";
    header.appendChild(titleElement);

    if (iconUrl && iconOnClick) {
      let customIcon = createIconButton(iconUrl, iconTitle, iconOnClick);
      header.appendChild(customIcon);
    }

    if (showRefreshButton && refreshOnClick) {
      let refreshButton = createIconButton(
        "https://img.icons8.com/?size=100&id=35635&format=png&color=ffffff",
        "Refresh",
        refreshOnClick
      );
      header.appendChild(refreshButton);
    }

    if (showSettingsButton && settingsOnClick) {
      let settingsButton = createIconButton(
        "https://img.icons8.com/?size=100&id=2969&format=png&color=ffffff",
        "Settings",
        settingsOnClick
      );
      header.appendChild(settingsButton);
    }

    return header;
  }

  // Return an array of container elements that belong to a named group in the dock
  function getDockGroupMembers(dockPosition = "left", group) {
    const dockId =
      dockPosition === "right"
        ? "torn-scripts-dock-right"
        : "torn-scripts-dock";
    const dock = document.getElementById(dockId);
    if (!dock || !group) return [];
    return Array.from(dock.children).filter(
      (c) => c.getAttribute("data-torn-group") === String(group)
    );
  }

  function createIconButton(iconUrl, title, onClick) {
    let button = document.createElement("a");
    button.href = "#";
    button.title = title;
    button.className = "torn-icon-button";
    button.onclick = function (e) {
      e.preventDefault();
      onClick(e);
    };
    button.innerHTML = `<img src="${iconUrl}" alt="${title}" width="18" height="18" style="display:inline-block;vertical-align:middle;">`;
    return button;
  }

  function createListContainer() {
    let listContainer = document.createElement("div");
    listContainer.className = "torn-list-container";
    return listContainer;
  }

  function createStatusFooter(initialText = "Ready") {
    let statusFooter = document.createElement("div");
    statusFooter.className = "torn-script-status-footer";
    statusFooter.textContent = initialText;
    return statusFooter;
  }

  /**
   * Create a styled select element with options array [{ value, text, selected }]
   */
  function createStyledSelect(options = [], selectedValue, extraProps = {}) {
    const sel = document.createElement("select");
    sel.classList.add("torn-input-style");
    (options || []).forEach((opt) => {
      const o = document.createElement("option");
      o.value = String(opt.value == null ? "" : opt.value);
      o.textContent = opt.text == null ? o.value : String(opt.text);
      if (opt.selected) o.selected = true;
      sel.appendChild(o);
    });
    if (selectedValue !== undefined && selectedValue !== null)
      sel.value = String(selectedValue);
    Object.assign(sel, extraProps);
    return sel;
  }

  /**
   * Create a table element with headers and rows.
   * columns: [{ key: 'id', title: 'ID', render: (value,row)=>elOrString }]
   * data: array of row objects
   * opts: { className, tableAttrs }
   */
  function createTable(columns = [], data = [], opts = {}) {
    const table = document.createElement("table");
    table.className = opts.className || "torn-table";
    if (opts.tableAttrs) {
      Object.keys(opts.tableAttrs).forEach((k) =>
        table.setAttribute(k, opts.tableAttrs[k])
      );
    }

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    columns.forEach((col) => {
      const th = document.createElement("th");
      th.textContent = col.title || col.key || "";
      if (col.thClass) th.className = col.thClass;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    (data || []).forEach((row) => {
      const tr = document.createElement("tr");
      columns.forEach((col) => {
        const td = document.createElement("td");
        if (typeof col.render === "function") {
          const rendered = col.render(row[col.key], row);
          if (rendered instanceof Node) td.appendChild(rendered);
          else td.textContent = rendered == null ? "" : String(rendered);
        } else {
          const v = row[col.key];
          td.textContent = v == null ? "" : String(v);
        }
        if (col.tdClass) td.className = col.tdClass;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    return table;
  }

  function getCommonStyles() {
    return {
      listItem: {
        margin: "3px",
        padding: "5px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        backgroundColor: "var(--default-bg-panel-color)",
        borderRadius: "5px",
      },
      buttonWrapper: {
        display: "flex",
      },
      iconButton: {
        marginLeft: "10px",
        display: "flex",
        alignItems: "center",
        textDecoration: "none",
        fontSize: "16px",
        cursor: "pointer",
      },
    };
  }

  ensureDockContainer("left");
})();
