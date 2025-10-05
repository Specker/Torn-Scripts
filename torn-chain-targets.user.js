// ==UserScript==
// @name         Torn Chain Targets
// @namespace    http://tampermonkey.net/
// @version      1.0.1
// @description  Chain attack targets
// @author       Specker [3313059]
// @copyright    2025 Specker
// @match        https://www.torn.com/*
// @exclude      https://www.torn.com/api.html
// @exclude      https://www.torn.com/swagger.php
// @icon         https://www.google.com/s2/favicons?sz=64&domain=torn.com
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @grant        GM_addStyle
// @grant        GM_getResourceText
// @connect      yata.yt
// @connect      api.torn.com
// @connect      ffscouter.com
// @downloadURL  https://github.com/Specker/Torn-Scripts/raw/refs/heads/main/torn-chain-targets.user.js
// @updateURL    https://github.com/Specker/Torn-Scripts/raw/refs/heads/main/torn-chain-targets.user.js
// @require      https://github.com/Specker/Torn-Scripts/raw/refs/heads/main/torn-ui-components.user.js
// @resource     styles https://github.com/Specker/Torn-Scripts/raw/refs/heads/main/torn-ui-components.css
// ==/UserScript==

(function () {
  "use strict";

  const css = GM_getResourceText("styles");

  GM_addStyle(css);

  // YATA related storage keys
  const STORAGE_YATA_API_KEY = "tornChainTargetsYataApiKey";
  const STORAGE_YATA_TARGETS = "tornChainTargetsTargets";
  // FFs (FFscouter) related storage keys
  const STORAGE_FFs_API_KEY = "tornChainTargetsFFsApiKey";
  const STORAGE_FFs_MINLVL = "tornChainTargetsFFsMinLVL";
  const STORAGE_FFs_MAXLVL = "tornChainTargetsFFsMaxLVL";
  const STORAGE_FFs_MINFF = "tornChainTargetsFFsMinFF";
  const STORAGE_FFs_MAXFF = "tornChainTargetsFFsMaxFF";
  const STORAGE_FFs_INACTIVE = "tornChainTargetsFFsInactive";
  const STORAGE_FFs_LIMIT = "tornChainTargetsFFsLimit";
  const STORAGE_FFs_TARGETS = "tornChainTargetsFFsTargets";
  const STORAGE_FFs_FF = "tornChainTargetsFFsTargetsFF";
  // Updater state storage key
  const STORAGE_TIME_KEY = "tornChainTargetsDataTime";
  const STORAGE_UPDATER_STATE = "tornChainTargetsUpdaterState";
  const STORAGE_TAB_COORDINATION = "tornChainTargetsTabCoordination";
  // Combined state storage key
  const STORAGE_COMBINED_KEY = "tornChainTargetsState_v1";
  // Sort order storage key (FF sort ascending = "1")
  const STORAGE_FFs_SORT_ORDER = "tornChainTargetsFFsSortAsc";

  const TWENTY_MINUTES = 20 * 60 * 1000;
  const BATCH_INTERVAL_MS = 10 * 1000;
  const CYCLE_PAUSE_MS = 5 * 60 * 1000;
  const HEARTBEAT_INTERVAL_MS = 15 * 1000;
  const TAB_TIMEOUT_MS = 60 * 1000;

  const BATCH_SIZE = 5;

  let tabId = Math.random().toString(36).substr(2, 9);
  let isActiveTab = false;
  let heartbeatIntervalId = null;
  let coordinationCheckIntervalId = null;

  let listContainer;
  let statusFooter;
  let scriptContainer;
  let currentDockPosition = "left";

  (function createInterface() {
    const dockPosition = (function () {
      try {
        const v = getStateProp("meta.dockPosition", "left");
        return v === "right" ? "right" : "left";
      } catch (_) {
        return "left";
      }
    })();

    const {
      container: cont,
      listContainer: lc,
      statusFooter: sf,
    } = TornUI.createScriptContainer({
      title: "Chain Targets",
      showSettingsButton: false,
      showRefreshButton: true,
      refreshOnClick: function (e) {
        if (tryBecomeActiveTab()) {
          startTargetsUpdater(true);
          fetchAndStoreTargetsData(true);
        } else {
          console.log(
            "Chain Targets: Could not become active tab for manual refresh"
          );
        }
      },
      showStatusFooter: true,
      statusText: "Updater: checking tab coordination...",
      dockPosition: dockPosition,
    });

    scriptContainer = cont;
    try {
      scriptContainer.setAttribute("data-script-id", "torn-chain-targets");
    } catch (_) {}

    listContainer = lc;
    statusFooter = sf;
    currentDockPosition = dockPosition;
  })();

  let ffSortAsc = (function () {
    try {
      const v = getStateProp("ffs.sortAsc", false);
      return v === true || v === "1" || v === 1;
    } catch (_) {
      return false;
    }
  })();
  function createFFSortButton() {
    try {
      const container = listContainer.parentElement;
      if (!container) return;
      const header = container.querySelector(".torn-header");
      if (!header) return;

      const btn = document.createElement("a");
      btn.href = "#";
      btn.className = "torn-icon-button";
      btn.title = "Toggle FF sort (highest/lowest)";

      const updateBtn = () => {
        const arrow = ffSortAsc ? "▲" : "▼";
        btn.innerHTML = `<span style="font-weight:600;display:inline-flex;align-items:center;">FF<span style=\"display:inline-block;width:12px;\">${arrow}</span></span>`;
      };

      btn.addEventListener("click", (e) => {
        e.preventDefault();
        ffSortAsc = !ffSortAsc;
        try {
          setStateProp("ffs.sortAsc", !!ffSortAsc);
        } catch (_) {}
        updateBtn();
        try {
          const latest = storageGetJson(STORAGE_YATA_TARGETS, []);
          renderTargetsList(latest);
        } catch (_) {}
      });

      updateBtn();
      header.appendChild(btn);
    } catch (e) {
      console.error("Failed to create FF sort button:", e);
    }
  }

  try {
    createFFSortButton();
  } catch (_) {}

  function storageGet(key, fallback) {
    try {
      const mapping = {
        [STORAGE_YATA_API_KEY]: "yata.apiKey",
        [STORAGE_YATA_TARGETS]: "yata.targets",
        [STORAGE_FFs_API_KEY]: "ffs.apiKey",
        [STORAGE_FFs_MINLVL]: "ffs.minLvl",
        [STORAGE_FFs_MAXLVL]: "ffs.maxLvl",
        [STORAGE_FFs_MINFF]: "ffs.minFF",
        [STORAGE_FFs_MAXFF]: "ffs.maxFF",
        [STORAGE_FFs_INACTIVE]: "ffs.inactive",
        [STORAGE_FFs_LIMIT]: "ffs.limit",
        [STORAGE_FFs_TARGETS]: "ffs.targets",
        [STORAGE_FFs_FF]: "ffs.targets_ff",
        [STORAGE_TIME_KEY]: "yata.timeKey",
        [STORAGE_UPDATER_STATE]: "updater",
        [STORAGE_TAB_COORDINATION]: "tabCoordination",
        [STORAGE_FFs_SORT_ORDER]: "ffs.sortAsc",
      };
      if (mapping[key]) {
        const v = getStateProp(mapping[key], fallback);
        return v === undefined || v === null ? fallback : String(v);
      }
      const v = localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch (e) {
      console.error("storageGet error:", e);
      return fallback;
    }
  }

  function storageSet(key, value) {
    try {
      const mapping = {
        [STORAGE_YATA_API_KEY]: "yata.apiKey",
        [STORAGE_YATA_TARGETS]: "yata.targets",
        [STORAGE_FFs_API_KEY]: "ffs.apiKey",
        [STORAGE_FFs_MINLVL]: "ffs.minLvl",
        [STORAGE_FFs_MAXLVL]: "ffs.maxLvl",
        [STORAGE_FFs_MINFF]: "ffs.minFF",
        [STORAGE_FFs_MAXFF]: "ffs.maxFF",
        [STORAGE_FFs_INACTIVE]: "ffs.inactive",
        [STORAGE_FFs_LIMIT]: "ffs.limit",
        [STORAGE_FFs_TARGETS]: "ffs.targets",
        [STORAGE_FFs_FF]: "ffs.targets_ff",
        [STORAGE_TIME_KEY]: "yata.timeKey",
        [STORAGE_UPDATER_STATE]: "updater",
        [STORAGE_TAB_COORDINATION]: "tabCoordination",
        [STORAGE_FFs_SORT_ORDER]: "ffs.sortAsc",
      };
      if (mapping[key]) {
        return setStateProp(mapping[key], value);
      }
      localStorage.setItem(key, String(value));
      return true;
    } catch (e) {
      console.error("storageSet error:", e);
      return false;
    }
  }

  function storageGetJson(key, fallback) {
    try {
      const mapping = {
        [STORAGE_YATA_TARGETS]: "yata.targets",
        [STORAGE_FFs_TARGETS]: "ffs.targets",
        [STORAGE_FFs_FF]: "ffs.targets_ff",
        [STORAGE_UPDATER_STATE]: "updater",
        [STORAGE_TAB_COORDINATION]: "tabCoordination",
      };
      if (mapping[key]) {
        const v = getStateProp(mapping[key], fallback);
        return v === undefined ? fallback : v;
      }
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      console.error("storageGetJson error for", key, e);
      return fallback;
    }
  }

  function storageSetJson(key, value) {
    try {
      const mapping = {
        [STORAGE_YATA_TARGETS]: "yata.targets",
        [STORAGE_FFs_TARGETS]: "ffs.targets",
        [STORAGE_FFs_FF]: "ffs.targets_ff",
        [STORAGE_UPDATER_STATE]: "updater",
        [STORAGE_TAB_COORDINATION]: "tabCoordination",
      };
      if (mapping[key]) {
        return setStateProp(mapping[key], value);
      }
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error("storageSetJson error for", key, e);
      return false;
    }
  }

  function storageRemove(key) {
    try {
      const mapping = {
        [STORAGE_YATA_API_KEY]: "yata.apiKey",
        [STORAGE_YATA_TARGETS]: "yata.targets",
        [STORAGE_FFs_API_KEY]: "ffs.apiKey",
        [STORAGE_FFs_MINLVL]: "ffs.minLvl",
        [STORAGE_FFs_MAXLVL]: "ffs.maxLvl",
        [STORAGE_FFs_MINFF]: "ffs.minFF",
        [STORAGE_FFs_MAXFF]: "ffs.maxFF",
        [STORAGE_FFs_INACTIVE]: "ffs.inactive",
        [STORAGE_FFs_LIMIT]: "ffs.limit",
        [STORAGE_FFs_TARGETS]: "ffs.targets",
        [STORAGE_FFs_FF]: "ffs.targets_ff",
        [STORAGE_TIME_KEY]: "yata.timeKey",
        [STORAGE_UPDATER_STATE]: "updater",
        [STORAGE_TAB_COORDINATION]: "tabCoordination",
        [STORAGE_FFs_SORT_ORDER]: "ffs.sortAsc",
      };
      if (mapping[key]) {
        return deleteStateProp(mapping[key]);
      }
      localStorage.removeItem(key);
      return true;
    } catch (e) {
      console.error("storageRemove error:", e);
      return false;
    }
  }

  function defaultState() {
    return {
      version: 1,
      yata: { apiKey: "", targets: [], timeKey: null },
      ffs: {
        apiKey: "",
        minLvl: "1",
        maxLvl: "100",
        minFF: "2.0",
        maxFF: "2.5",
        inactive: "1",
        limit: "50",
        targets: [],
        targets_ff: [],
        sortAsc: false,
      },
      updater: {},
      tabCoordination: {},
      meta: { lastUpdated: Date.now() },
    };
  }

  function readState() {
    try {
      const raw = localStorage.getItem(STORAGE_COMBINED_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return defaultState();
      const base = Object.assign(defaultState(), parsed);
      base.meta = Object.assign(defaultState().meta, parsed.meta || {});
      return base;
    } catch (e) {
      console.error("Failed to parse combined state, resetting:", e);
      try {
        localStorage.setItem(
          STORAGE_COMBINED_KEY + "_corrupt_backup",
          localStorage.getItem(STORAGE_COMBINED_KEY)
        );
      } catch (_) {}
      return defaultState();
    }
  }

  function writeState(state) {
    try {
      state.meta = state.meta || {};
      state.meta.lastUpdated = Date.now();
      localStorage.setItem(STORAGE_COMBINED_KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      console.error("Failed to write combined state:", e);
      return false;
    }
  }

  function getStateProp(path, fallback) {
    const state = readState();
    const parts = path.split(".");
    let cur = state;
    for (const p of parts) {
      if (cur && typeof cur === "object" && p in cur) cur = cur[p];
      else return fallback;
    }
    return cur;
  }

  function setStateProp(path, value) {
    const state = readState();
    const parts = path.split(".");
    let cur = state;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (!(p in cur) || typeof cur[p] !== "object") cur[p] = {};
      cur = cur[p];
    }
    cur[parts[parts.length - 1]] = value;
    return writeState(state);
  }

  function deleteStateProp(path) {
    try {
      const state = readState();
      const parts = path.split(".");
      let cur = state;
      for (let i = 0; i < parts.length - 1; i++) {
        const p = parts[i];
        if (!(p in cur) || typeof cur[p] !== "object") return true;
        cur = cur[p];
      }
      delete cur[parts[parts.length - 1]];
      return writeState(state);
    } catch (e) {
      console.error("deleteStateProp error:", e);
      return false;
    }
  }

  function promptAndSave(options) {
    const cur = storageGet(options.key, options.default || "");
    const v = prompt(options.title, cur);
    if (v === null) return;
    try {
      const transformed = options.transform
        ? options.transform(v.trim())
        : v.trim();
      storageSet(options.key, transformed);
      if (typeof options.onSaved === "function") options.onSaved(transformed);
    } catch (err) {
      console.error("promptAndSave failed:", err);
    }
  }

  if (typeof GM_registerMenuCommand === "function") {
    try {
      GM_registerMenuCommand("Toggle dock position (Left/Heresy)", function () {
        try {
          const cur = getStateProp("meta.dockPosition", "left");
          const next = cur === "right" ? "left" : "right";
          setStateProp("meta.dockPosition", next);
          try {
            moveContainerTo(next);
          } catch (e) {
            alert(
              "Dock position set to: " +
                next +
                ". Please reload the page to apply."
            );
          }
        } catch (e) {
          console.error("Failed to toggle dock position:", e);
        }
      });
    } catch (e) {}
    try {
      GM_registerMenuCommand("Set YATA API key", function () {
        promptAndSave({
          title: "Set YATA API key",
          key: STORAGE_YATA_API_KEY,
          default: "",
          transform: (s) => s,
          onSaved: () => {
            fetchAndStoreTargetsData(true);
          },
        });
      });

      GM_registerMenuCommand("Set FFs API key", function () {
        promptAndSave({
          title: "Set FFs API key",
          key: STORAGE_FFs_API_KEY,
          default: "",
          transform: (s) => s,
        });
      });

      try {
        const ffKey = storageGet(STORAGE_FFs_API_KEY, "") || "";
        if (ffKey) {
          const ffCmds = [
            {
              title: "Set FFs Min Level",
              key: STORAGE_FFs_MINLVL,
              default: "1",
              transform: (s) => String(parseInt(s, 10) || 1),
            },
            {
              title: "Set FFs Max Level",
              key: STORAGE_FFs_MAXLVL,
              default: "100",
              transform: (s) => String(parseInt(s, 10) || 100),
            },
            {
              title: "Set FFs Min FF",
              key: STORAGE_FFs_MINFF,
              default: "2.0",
              transform: (s) => {
                const n = parseFloat(s);
                return isNaN(n) ? "0" : String(n);
              },
            },
            {
              title: "Set FFs Max FF",
              key: STORAGE_FFs_MAXFF,
              default: "2.5",
              transform: (s) => {
                const n = parseFloat(s);
                return isNaN(n) ? "0" : String(n);
              },
            },
            {
              title: "Set FFs Include Inactive",
              key: STORAGE_FFs_INACTIVE,
              default: "1",
              transform: (s) => (s === "1" ? "1" : "0"),
            },
            {
              title: "Set FFs Limit",
              key: STORAGE_FFs_LIMIT,
              default: "50",
              transform: (s) => String(parseInt(s, 10) || 50),
            },
          ];

          ffCmds.forEach((c) => {
            GM_registerMenuCommand(c.title, function () {
              promptAndSave(c);
            });
          });
        }
      } catch (_) {}
    } catch (e) {
      console.warn("GM_registerMenuCommand not available:", e);
    }
  }

  function moveContainerTo(dockPosition) {
    if (!scriptContainer) return;
    const pos = dockPosition === "right" ? "right" : "left";
    const dock = TornUI.ensureDockContainer(pos);
    if (
      scriptContainer.parentElement &&
      scriptContainer.parentElement !== dock
    ) {
      try {
        scriptContainer.parentElement.removeChild(scriptContainer);
      } catch (_) {}
    }
    try {
      dock.appendChild(scriptContainer);
      TornUI.updateDockColumns(dock);
      currentDockPosition = pos;
    } catch (e) {
      console.error("Failed to move container to dock:", e);
    }
  }

  window.addEventListener("storage", function (ev) {
    try {
      if (!ev.key) return;
      if (ev.key === STORAGE_COMBINED_KEY) {
        if (!ev.newValue) return;
        try {
          const parsed = JSON.parse(ev.newValue);
          const next = parsed && parsed.meta && parsed.meta.dockPosition;
          if (next && next !== currentDockPosition) {
            moveContainerTo(next === "right" ? "right" : "left");
          }
        } catch (e) {}
      }
    } catch (e) {
      console.error("storage event handler error:", e);
    }
  });

  let updaterState = {
    timerId: null,
    cycleTimerId: null,
    queue: [],
    index: 0,
    running: false,
  };

  let statusIntervalId = null;
  let nextCycleEndsAt = null;

  function getTabCoordination() {
    try {
      const obj = storageGetJson(STORAGE_TAB_COORDINATION, null);
      if (!obj || typeof obj !== "object") return null;
      if (Object.keys(obj).length === 0) return null;
      if (!obj.activeTabId || !obj.lastHeartbeat) return null;
      return obj;
    } catch (e) {
      return null;
    }
  }

  function setTabCoordination(data) {
    storageSetJson(STORAGE_TAB_COORDINATION, data);
  }

  function clearTabCoordination() {
    storageRemove(STORAGE_TAB_COORDINATION);
  }

  function updateHeartbeat() {
    if (!isActiveTab) return;
    const coordination = getTabCoordination();
    if (coordination && coordination.activeTabId === tabId) {
      coordination.lastHeartbeat = Date.now();
      setTabCoordination(coordination);
    }
  }

  function startHeartbeat() {
    if (heartbeatIntervalId) {
      clearInterval(heartbeatIntervalId);
    }
    heartbeatIntervalId = setInterval(updateHeartbeat, HEARTBEAT_INTERVAL_MS);
    updateHeartbeat();
  }

  function stopHeartbeat() {
    if (heartbeatIntervalId) {
      clearInterval(heartbeatIntervalId);
      heartbeatIntervalId = null;
    }
  }

  function tryBecomeActiveTab() {
    const coordination = getTabCoordination();
    const now = Date.now();

    if (!coordination) {
      setTabCoordination({
        activeTabId: tabId,
        lastHeartbeat: now,
        lastUpdate: now,
      });
      isActiveTab = true;
      startHeartbeat();
      try {
        updateStatusFooter();
      } catch (_) {}
      return true;
    }

    if (coordination.activeTabId === tabId) {
      isActiveTab = true;
      startHeartbeat();
      try {
        updateStatusFooter();
      } catch (_) {}
      return true;
    }

    const timeSinceHeartbeat = now - coordination.lastHeartbeat;
    if (timeSinceHeartbeat > TAB_TIMEOUT_MS) {
      setTabCoordination({
        activeTabId: tabId,
        lastHeartbeat: now,
        lastUpdate: now,
      });
      isActiveTab = true;
      startHeartbeat();
      try {
        updateStatusFooter();
      } catch (_) {}
      return true;
    }

    isActiveTab = false;
    stopHeartbeat();
    return false;
  }

  function checkTabCoordination() {
    if (!isActiveTab) {
      if (tryBecomeActiveTab()) {
        console.log("Chain Targets: Became active tab, starting updater");
        startTargetsUpdater(false);
        try {
          updateStatusFooter();
        } catch (_) {}
      }
    } else {
      const coordination = getTabCoordination();
      if (!coordination || coordination.activeTabId !== tabId) {
        isActiveTab = false;
        stopHeartbeat();
        stopTargetsUpdater(false);
        console.log("Chain Targets: Lost active tab status");
        try {
          updateStatusFooter();
        } catch (_) {}
      }
    }
  }

  function startTabCoordination() {
    checkTabCoordination();

    coordinationCheckIntervalId = setInterval(
      checkTabCoordination,
      HEARTBEAT_INTERVAL_MS
    );

    window.addEventListener("beforeunload", () => {
      if (isActiveTab) {
        clearTabCoordination();
      }
      stopHeartbeat();
      if (coordinationCheckIntervalId) {
        clearInterval(coordinationCheckIntervalId);
      }
      try {
        updateStatusFooter();
      } catch (_) {}
    });
  }

  function saveUpdaterState(extra = {}) {
    try {
      const state = {
        queue: updaterState.queue,
        index: updaterState.index,
        running: updaterState.running,
        lastTickAt: Date.now(),
        nextCycleEndsAt: nextCycleEndsAt,
        phase: updaterState.running
          ? "running"
          : updaterState.cycleTimerId
          ? "waiting"
          : "idle",
        ...extra,
      };
      storageSetJson(STORAGE_UPDATER_STATE, state);
    } catch (e) {
      console.error("Failed to persist updater state:", e);
    }
  }

  function loadUpdaterState() {
    try {
      const obj = storageGetJson(STORAGE_UPDATER_STATE, null);
      if (!obj || typeof obj !== "object") return null;
      if (Object.keys(obj).length === 0) return null;
      if (!obj.lastTickAt && !Array.isArray(obj.queue)) return null;
      return obj;
    } catch (e) {
      return null;
    }
  }

  function clearUpdaterState() {
    storageRemove(STORAGE_UPDATER_STATE);
  }

  function shouldResumeSavedState(saved) {
    if (!saved) return false;
    if (!saved.lastTickAt) return false;
    const age = Date.now() - saved.lastTickAt;
    return age <= 60 * 1000;
  }

  function setStatusIntervalActive(active) {
    if (!active) {
      if (statusIntervalId) {
        clearInterval(statusIntervalId);
        statusIntervalId = null;
      }
      return;
    }
    if (statusIntervalId) return;
    statusIntervalId = setInterval(updateStatusFooter, 1000);
  }

  function stopTargetsUpdater(persist = true) {
    if (updaterState.timerId) {
      clearTimeout(updaterState.timerId);
      updaterState.timerId = null;
    }
    if (updaterState.cycleTimerId) {
      clearTimeout(updaterState.cycleTimerId);
      updaterState.cycleTimerId = null;
    }
    setStatusIntervalActive(false);
    nextCycleEndsAt = null;
    updaterState.queue = [];
    updaterState.index = 0;
    updaterState.running = false;
    if (persist) saveUpdaterState();

    if (!isActiveTab) {
      stopHeartbeat();
    }

    updateStatusFooter();
  }

  function getTargetsArrayFromStorage() {
    const data = storageGetJson(STORAGE_YATA_TARGETS, null);
    if (!Array.isArray(data)) return null;
    return data;
  }

  function isPlayerInTargets(playerId) {
    if (!playerId) return false;
    try {
      const arr = getTargetsArrayFromStorage();
      if (!Array.isArray(arr)) return false;
      return arr.some((t) => String(t.player_id) === String(playerId));
    } catch (e) {
      return false;
    }
  }

  function formatMs(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m + ":" + (s < 10 ? "0" + s : s);
  }

  function updateStatusFooter() {
    const total = updaterState.queue.length;
    const done = Math.min(updaterState.index, total);
    let nextId = updaterState.queue[updaterState.index];
    let nextName = "";
    const targetsArr = getTargetsArrayFromStorage();
    if (targetsArr && nextId) {
      const t = targetsArr.find((tt) => tt.player_id == nextId);
      if (t) nextName = t.name || "";
    }

    let statusText = "";
    if (updaterState.running) {
      const nextText = nextId
        ? nextName
          ? nextName + " [" + nextId + "]"
          : "[" + nextId + "]"
        : "-";
      statusText =
        "Updater: running | Next: " +
        nextText +
        " | Updated: " +
        done +
        "/" +
        total;
    } else if (updaterState.cycleTimerId && nextCycleEndsAt) {
      const remaining = nextCycleEndsAt - Date.now();
      statusText =
        "Updater: waiting | Next refresh in: " +
        formatMs(remaining) +
        " | Updated last cycle: " +
        done +
        "/" +
        total;
    } else {
      statusText = "Updater: idle";
    }

    if (isActiveTab) {
      statusText += "";
    } else {
      statusText = "Updater: running in another tab";
    }

    statusFooter.textContent = statusText;
  }

  function statusColorFromState(state) {
    switch (state) {
      case "Okay":
        return "green";
      case "Hospital":
        return "red";
      case "Jail":
        return "red";
      case "Traveling":
        return "red";
      case "Abroad":
        return "red";
      case "Fallen":
        return "red";
      default:
        return undefined;
    }
  }

  function mergeTornProfileIntoStorage(playerId, profileJson) {
    try {
      const arr = storageGetJson(STORAGE_YATA_TARGETS, null);
      if (!Array.isArray(arr)) return;
      const idx = arr.findIndex((x) => x.player_id == playerId);
      if (idx === -1) return;
      const t = arr[idx];
      t.torn_profile = profileJson;
      if (profileJson && profileJson.status) {
        const state = profileJson.status.state;
        const description = profileJson.status.description || state || "";
        const color = statusColorFromState(state);
        t.status_state = state;
        if (description) t.status_description = description;
        if (color) t.status_color = color;
      }
      storageSetJson(STORAGE_YATA_TARGETS, arr);

      try {
        const latest = storageGetJson(STORAGE_YATA_TARGETS, []);
        renderTargetsList(latest);
      } catch (_) {
        renderTargetsList(arr);
      }
      updateStatusFooter();
    } catch (err) {
      console.error("Failed to merge Torn profile:", err);
    }
  }

  function fetchTornUserProfile(playerId) {
    const apiKey = storageGet(STORAGE_YATA_API_KEY, "") || "";
    if (!apiKey) return Promise.resolve();
    const url = `https://api.torn.com/user/${encodeURIComponent(
      playerId
    )}?selections=profile&key=${encodeURIComponent(apiKey)}`;
    return new Promise((resolve) => {
      GM_xmlhttpRequest({
        method: "GET",
        url: url,
        onload: function (response) {
          try {
            if (response.status !== 200)
              throw new Error(response.status + " " + response.statusText);
            const json = JSON.parse(response.responseText);
            mergeTornProfileIntoStorage(playerId, json);
          } catch (err) {
            console.error("Torn API fetch failed for", playerId, err);
          } finally {
            resolve();
          }
        },
        onerror: function () {
          resolve();
        },
      });
    });
  }

  function processNextBatch() {
    if (updaterState.index >= updaterState.queue.length) {
      updaterState.running = false;
      nextCycleEndsAt = Date.now() + CYCLE_PAUSE_MS;
      setStatusIntervalActive(true);
      updateStatusFooter();
      saveUpdaterState();
      updaterState.cycleTimerId = setTimeout(() => {
        setStatusIntervalActive(false);
        nextCycleEndsAt = null;
        startTargetsUpdater(false);
      }, CYCLE_PAUSE_MS);
      return;
    }
    const batchIds = [];
    for (
      let i = 0;
      i < BATCH_SIZE && updaterState.index < updaterState.queue.length;
      i++
    ) {
      batchIds.push(updaterState.queue[updaterState.index++]);
    }
    updateStatusFooter();
    saveUpdaterState();
    Promise.all(batchIds.map((id) => fetchTornUserProfile(id))).then(() => {
      updaterState.timerId = setTimeout(processNextBatch, BATCH_INTERVAL_MS);
    });
  }

  function startTargetsUpdater(startImmediately) {
    if (!isActiveTab) {
      console.log("Chain Targets: Not active tab, skipping updater start");
      updateStatusFooter();
      return;
    }

    stopTargetsUpdater(false);
    const targetsArr = getTargetsArrayFromStorage();
    if (!targetsArr) {
      updateStatusFooter();
      return;
    }

    const saved = loadUpdaterState();
    if (
      shouldResumeSavedState(saved) &&
      Array.isArray(saved.queue) &&
      saved.queue.length > 0
    ) {
      updaterState.queue = saved.queue;
      updaterState.index = Math.min(
        saved.index || 0,
        updaterState.queue.length
      );
      updaterState.running = saved.phase === "running";
      nextCycleEndsAt = saved.nextCycleEndsAt || null;
      if (
        saved.phase === "waiting" &&
        nextCycleEndsAt &&
        nextCycleEndsAt > Date.now()
      ) {
        setStatusIntervalActive(true);
        updateStatusFooter();
        updaterState.cycleTimerId = setTimeout(() => {
          setStatusIntervalActive(false);
          nextCycleEndsAt = null;
          startTargetsUpdater(false);
        }, nextCycleEndsAt - Date.now());
        saveUpdaterState();
        return;
      }

      updaterState.running = true;
      updateStatusFooter();
      saveUpdaterState();
      processNextBatch();
      return;
    }

    updaterState.queue = targetsArr.map((t) => t.player_id);
    updaterState.index = 0;
    updaterState.running = true;
    updateStatusFooter();
    saveUpdaterState();
    if (startImmediately) {
      processNextBatch();
    } else {
      updaterState.timerId = setTimeout(processNextBatch, BATCH_INTERVAL_MS);
    }
  }

  function fetchAndStoreTargetsData(restartAfterFetch = false) {
    const apiKey = storageGet(STORAGE_YATA_API_KEY, "") || "";
    if (!apiKey) {
      listContainer.innerHTML =
        '<div style="text-align:center;padding:20px;">Set your YATA API key in settings.</div>';
      return;
    }
    listContainer.innerHTML =
      '<div style="text-align:center;padding:20px;">Loading...</div>';
    const url = `https://yata.yt/api/v1/targets/export/?key=${encodeURIComponent(
      apiKey
    )}`;
    GM_xmlhttpRequest({
      method: "GET",
      url: url,
      onload: function (response) {
        try {
          if (response.status !== 200) {
            throw new Error(response.status + " " + response.statusText);
          }
          const data = JSON.parse(response.responseText);

          const targetsOBJs = data.targets;
          const targets = [];

          for (const key in targetsOBJs) {
            const target = targetsOBJs[key];
            target.player_id = key;
            targets.push(target);
          }

          try {
            storageSetJson(STORAGE_YATA_TARGETS, targets);
            storageSet(STORAGE_TIME_KEY, Date.now().toString());
            if (restartAfterFetch) {
              clearUpdaterState();
            }
          } catch (e) {
            console.error("Failed to store targets data:", e);
          }
          renderTargetsList(targets);

          try {
            const ffKey = storageGet(STORAGE_FFs_API_KEY, "") || "";
            if (ffKey) {
              fetchFFsStats({
                targets: targets.map((t) =>
                  String(t.player_id || t.id || t.playerId || "")
                ),
              }).catch((err) => {
                console.error(
                  "Failed to fetch FFs stats after targets import:",
                  err
                );
              });
            }
          } catch (_) {}

          if (restartAfterFetch) {
            startTargetsUpdater(true);
          }
        } catch (err) {
          console.error("Failed to fetch targets:", err);
          const prevData = storageGetJson(STORAGE_YATA_TARGETS, null);
          if (Array.isArray(prevData) && prevData.length > 0) {
            renderTargetsList(prevData);
            return;
          }
          listContainer.innerHTML =
            '<div style="text-align:center;padding:20px;">No targets available.</div>';
        }
      },
      onerror: function (error) {
        console.error("Request error:", error);
        const prevData = storageGetJson(STORAGE_YATA_TARGETS, null);
        if (Array.isArray(prevData) && prevData.length > 0) {
          renderTargetsList(prevData);
          return;
        }
        listContainer.innerHTML =
          '<div style="text-align:center;padding:20px;">No targets available.</div>';
      },
    });
  }

  function fetchFFsTargets(overrides = {}) {
    const apiKey =
      overrides.apiKey || storageGet(STORAGE_FFs_API_KEY, "") || "";
    if (!apiKey) return Promise.reject(new Error("Missing FFs API key"));

    const minlevel =
      overrides.minlevel || storageGet(STORAGE_FFs_MINLVL, "1") || "1";
    const maxlevel =
      overrides.maxlevel || storageGet(STORAGE_FFs_MAXLVL, "100") || "100";
    const minff =
      overrides.minff || storageGet(STORAGE_FFs_MINFF, "2.0") || "2.0";
    const maxff =
      overrides.maxff || storageGet(STORAGE_FFs_MAXFF, "2.5") || "2.5";
    const inactiveonly =
      typeof overrides.inactiveonly !== "undefined"
        ? String(overrides.inactiveonly)
        : storageGet(STORAGE_FFs_INACTIVE, "1") || "1";
    const limit =
      overrides.limit || storageGet(STORAGE_FFs_LIMIT, "50") || "50";

    const url = `https://ffscouter.com/api/v1/get-targets?key=${encodeURIComponent(
      apiKey
    )}&minlevel=${encodeURIComponent(minlevel)}&maxlevel=${encodeURIComponent(
      maxlevel
    )}&minff=${encodeURIComponent(minff)}&maxff=${encodeURIComponent(
      maxff
    )}&inactiveonly=${encodeURIComponent(
      inactiveonly
    )}&limit=${encodeURIComponent(limit)}`;

    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "GET",
        url: url,
        onload: function (response) {
          try {
            if (response.status !== 200)
              throw new Error(response.status + " " + response.statusText);
            const json = JSON.parse(response.responseText || "{}");
            resolve(json);
          } catch (err) {
            reject(err);
          }
        },
        onerror: function () {
          reject(new Error("Network error while fetching FFs targets"));
        },
      });
    });
  }

  async function fetchFFsStats(options = {}) {
    const apiKey = options.apiKey || storageGet(STORAGE_FFs_API_KEY, "") || "";
    if (!apiKey) return Promise.reject(new Error("Missing FFs API key"));

    let targets = [];
    if (Array.isArray(options.targets)) {
      targets = options.targets.map((t) => String(t));
    } else {
      try {
        const arr = storageGetJson(STORAGE_FFs_TARGETS, []);
        if (Array.isArray(arr)) {
          targets = arr
            .map((t) => String(t.player_id || t.id || t.playerId || ""))
            .filter((x) => x);
        }
      } catch (_) {
        targets = [];
      }
    }

    if (!Array.isArray(targets) || targets.length === 0)
      return Promise.resolve([]);

    const MAX_PER_REQUEST = 200;
    const batches = [];
    for (let i = 0; i < targets.length; i += MAX_PER_REQUEST) {
      batches.push(targets.slice(i, i + MAX_PER_REQUEST));
    }

    const results = [];

    for (const batch of batches) {
      const listParam = encodeURIComponent(batch.join(","));
      const url = `https://ffscouter.com/api/v1/get-stats?key=${encodeURIComponent(
        apiKey
      )}&targets=${listParam}`;

      try {
        const json = await new Promise((resolve, reject) => {
          GM_xmlhttpRequest({
            method: "GET",
            url: url,
            onload: function (response) {
              try {
                if (response.status !== 200)
                  throw new Error(response.status + " " + response.statusText);
                const parsed = JSON.parse(response.responseText || "{}");
                resolve(parsed);
              } catch (err) {
                reject(err);
              }
            },
            onerror: function () {
              reject(new Error("Network error while fetching FFs stats"));
            },
          });
        });

        if (json) {
          if (Array.isArray(json)) {
            json.forEach((entry) => {
              const pid = String(
                entry.player_id || entry.id || entry.playerId || ""
              );
              if (!pid) return;
              results.push({
                id: pid,
                ff: entry.fair_fight,
                bs: entry.bs_estimate_human,
              });
            });
          } else if (json.targets && typeof json.targets === "object") {
            Object.keys(json.targets).forEach((k) => {
              const v = json.targets[k] || {};
              const pid = String(k);
              results.push({
                id: pid,
                ff: v.fair_fight,
                bs: v.bs_estimate_human,
              });
            });
          } else if (json.data && typeof json.data === "object") {
            Object.keys(json.data).forEach((k) => {
              const v = json.data[k] || {};
              const pid = String(k);
              results.push({
                id: pid,
                ff: v.fair_fight,
                bs: v.bs_estimate_human,
              });
            });
          } else if (json.player_id || json.id) {
            const pid = String(json.player_id || json.id || "");
            results.push({
              id: pid,
              ff: json.fair_fight,
              bs: json.bs_estimate_human,
            });
          }
        }
      } catch (err) {
        console.error(
          "Failed to fetch FFs stats for batch:",
          batch.slice(0, 5),
          "...",
          err
        );
      }
    }

    const seen = new Set();
    const deduped = [];
    for (const r of results) {
      if (!r || !r.id) continue;
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      deduped.push(r);
    }

    try {
      storageSetJson(STORAGE_FFs_FF, deduped);
    } catch (e) {
      console.error("Failed to persist FFs stats:", e);
    }

    return deduped;
  }

  async function importFFsTargets(overrides = {}, options = {}) {
    options = Object.assign(
      { addToLocal: true, render: true, startUpdater: false },
      options
    );

    let ffData;
    try {
      ffData = await fetchFFsTargets(overrides);
    } catch (err) {
      console.error("Failed to fetch FFs targets:", err);
      throw err;
    }

    const candidates = Array.isArray(ffData)
      ? ffData
      : Array.isArray(ffData.targets)
      ? ffData.targets
      : [];
    if (!candidates || candidates.length === 0) return { added: 0, skipped: 0 };

    let yataArr = storageGetJson(STORAGE_YATA_TARGETS, []);
    if (!Array.isArray(yataArr)) yataArr = [];

    const yataIds = new Set(yataArr.map((t) => String(t.player_id)));

    const filtered = (candidates || []).filter((t) => {
      const pid = String(
        t.player_id || t.id || t.playerId || (t.player_id === 0 ? "0" : "")
      );
      if (!pid) return false;
      return !yataIds.has(pid);
    });

    const prepared = filtered.map((t) => {
      const pid = String(
        t.player_id || t.id || t.playerId || (t.player_id === 0 ? "0" : "")
      );
      const entry = { player_id: pid };
      if (t.name) entry.name = t.name;
      if (t.fair_fight) entry.fair_fight = t.fair_fight;
      if (t.bs_estimate_human) entry.bs_estimate_human = t.bs_estimate_human;
      return entry;
    });

    const added = prepared.length;
    const skipped = (candidates ? candidates.length : 0) - added;

    if (added > 0 && options.addToLocal) {
      try {
        storageSetJson(STORAGE_FFs_TARGETS, prepared);
      } catch (err) {
        console.error("Failed to persist imported FFs targets:", err);
      }
    }

    if (added > 0 && options.render) {
      try {
        renderTargetsList(prepared);
      } catch (_) {}
    }

    if (added > 0 && options.startUpdater) {
      try {
        startTargetsUpdater(true);
      } catch (_) {}
    }

    return { added: added, skipped: skipped };
  }

  function buildListItem(t, label) {
    let listItem = document.createElement("li");
    listItem.className = "list-item-container";

    const name = t.name || "";
    const id = t.player_id || t.id || t.playerId;
    const fairFight = typeof t._ff !== "undefined" ? t._ff : t.fair_fight;
    const bsEstimate =
      typeof t._bs !== "undefined" ? t._bs : t.bs_estimate_human;

    let leftWrapper = document.createElement("div");
    leftWrapper.className = "chain-targets-left-wrapper";

    let statusBadge = document.createElement("span");
    statusBadge.className = "chain-targets-status-badge";
    statusBadge.title = t.status_description || "";
    statusBadge.style.background = t.status_color || "#888";

    let textSpan = document.createElement("span");
    let text = name + " [" + id + "]";
    textSpan.textContent = text;

    let contentWrapper = null;
    if (label) {
      contentWrapper = document.createElement("div");
      contentWrapper.style.display = "flex";
      contentWrapper.style.flexDirection = "column";
      contentWrapper.style.alignItems = "flex-start";

      const labelDiv = document.createElement("div");
      labelDiv.style.fontWeight = "600";
      labelDiv.style.marginBottom = "4px";
      labelDiv.textContent = label;
      contentWrapper.appendChild(labelDiv);
    }

    leftWrapper.appendChild(statusBadge);
    leftWrapper.appendChild(textSpan);
    if (contentWrapper) {
      contentWrapper.appendChild(leftWrapper);
    }

    if (fairFight !== undefined) {
      let ffSpan = document.createElement("span");
      ffSpan.className = "chain-targets-ff-span";
      ffSpan.textContent = " - FF" + fairFight;
      if (t.flat_respect !== undefined) {
        let frNum =
          typeof t.flat_respect === "number"
            ? t.flat_respect
            : parseFloat(t.flat_respect);
        if (!isNaN(frNum)) {
          ffSpan.title = "Flat respect: " + frNum.toFixed(2);
        } else {
          ffSpan.title = "Flat respect: " + t.flat_respect;
        }
      } else {
        ffSpan.title = "";
      }
      leftWrapper.appendChild(ffSpan);
    }
    if (
      typeof bsEstimate !== "undefined" &&
      bsEstimate !== null &&
      bsEstimate !== ""
    ) {
      let bsSpan = document.createElement("span");
      bsSpan.className = "chain-targets-bs-span";
      bsSpan.style.marginLeft = "6px";
      bsSpan.textContent = "(BS: " + bsEstimate + ")";
      leftWrapper.appendChild(bsSpan);
    }

    let buttonWrapper = document.createElement("div");
    buttonWrapper.className = "chain-targets-button-wrapper";

    let profileLink = document.createElement("a");
    profileLink.className = "list-item-link-button";
    profileLink.href = "https://www.torn.com/profiles.php?XID=" + id;
    profileLink.title = "Profile";
    profileLink.innerHTML = `<img src="https://img.icons8.com/?size=100&id=23265&format=png&color=ffffff" alt="Profile" width="18" height="18" style="display:inline-block;vertical-align:middle;">`;

    let attackLink = document.createElement("a");
    attackLink.className = "list-item-link-button";
    attackLink.href =
      "https://www.torn.com/loader.php?sid=attack&user2ID=" + id;
    attackLink.title = "Attack";
    attackLink.innerHTML = `<img src="https://img.icons8.com/?size=100&id=38919&format=png&color=ffffff" alt="Attack" width="18" height="18" style="display:inline-block;vertical-align:middle;">`;

    listItem.appendChild(contentWrapper || leftWrapper);
    buttonWrapper.appendChild(profileLink);
    buttonWrapper.appendChild(attackLink);
    listItem.appendChild(buttonWrapper);
    return listItem;
  }

  function renderTargetsList(data) {
    listContainer.innerHTML = "";
    let list = document.createElement("ul");

    const yataArr = storageGetJson(STORAGE_YATA_TARGETS, []);
    const targets =
      Array.isArray(yataArr) && yataArr.length > 0
        ? yataArr
        : Array.isArray(data)
        ? data
        : [];
    if (!targets || targets.length === 0) {
      listContainer.innerHTML =
        '<div style="text-align:center;padding:20px;">No targets found.</div>';
      return;
    }
    try {
      if (ffMap && ffMap.size > 0 && Array.isArray(targets)) {
        targets.forEach((t) => {
          try {
            const id = String(t.player_id || t.id || t.playerId || "");
            const p = ffMap.get(id);
            if (p) {
              t._ff = p.ff;
              t._bs = p.bs;
            }
          } catch (_) {}
        });
      }
    } catch (_) {}
    let persistedFFs = [];
    try {
      persistedFFs = storageGetJson(STORAGE_FFs_FF, []) || [];
    } catch (_) {
      persistedFFs = [];
    }
    const ffMap = new Map();
    if (Array.isArray(persistedFFs)) {
      persistedFFs.forEach((x) => {
        try {
          if (x && x.id) ffMap.set(String(x.id), x);
        } catch (_) {}
      });
    }

    function isOkay(t) {
      if (
        (t &&
          t.torn_profile &&
          t.torn_profile.status &&
          t.torn_profile.status.state === "Okay") ||
        t.status_state === "Okay"
      )
        return true;
      return false;
    }
    targets.sort((a, b) => {
      const aOk = isOkay(a) ? 1 : 0;
      const bOk = isOkay(b) ? 1 : 0;
      if (aOk !== bOk) return bOk - aOk;
      const aId = String(a.player_id || a.id || a.playerId || "");
      const bId = String(b.player_id || b.id || b.playerId || "");
      const aPersist = ffMap.get(aId);
      const bPersist = ffMap.get(bId);
      const aFr =
        aPersist && typeof aPersist.ff !== "undefined"
          ? parseFloat(aPersist.ff)
          : typeof a.flat_respect === "number"
          ? a.flat_respect
          : parseFloat(a.flat_respect || "0");
      const bFr =
        bPersist && typeof bPersist.ff !== "undefined"
          ? parseFloat(bPersist.ff)
          : typeof b.flat_respect === "number"
          ? b.flat_respect
          : parseFloat(b.flat_respect || "0");
      if (aPersist) {
        a._ff = aPersist.ff;
        a._bs = aPersist.bs;
      }
      if (bPersist) {
        b._ff = bPersist.ff;
        b._bs = bPersist.bs;
      }
      const left = aFr || 0;
      const right = bFr || 0;
      return ffSortAsc ? left - right : right - left;
    });

    let skipId = null;
    try {
      const ffArr = storageGetJson(STORAGE_FFs_TARGETS, []);
      if (Array.isArray(ffArr) && ffArr.length > 0) {
        const candidate = ffArr[0];
        const pId = String(
          candidate.player_id ||
            candidate.id ||
            candidate.playerId ||
            (candidate.player_id === 0 ? "0" : "")
        );
        if (pId && !targets.some((t) => String(t.player_id) === pId)) {
          const pItem = buildListItem(candidate, "possible target:");
          try {
            const profileAnchor = pItem.querySelector(
              'a[href*="profiles.php?XID="]'
            );
            const attackAnchor = pItem.querySelector(
              'a[href*="loader.php?sid=attack&user2ID="]'
            );
            const handleClickAndNavigate = (anchor, pid) => {
              return (ev) => {
                try {
                  removeFFsTargetById(pid);
                } catch (_) {}
              };
            };
            if (profileAnchor)
              profileAnchor.addEventListener(
                "click",
                handleClickAndNavigate(profileAnchor, pId)
              );
            if (attackAnchor)
              attackAnchor.addEventListener(
                "click",
                handleClickAndNavigate(attackAnchor, pId)
              );
          } catch (_) {
            /* ignore handler attach errors */
          }
          if (list.firstChild) list.insertBefore(pItem, list.firstChild);
          else list.appendChild(pItem);
          skipId = pId;
        }
      }
    } catch (_) {
      /* ignore local FFs parse errors */
    }

    targets.forEach((t) => {
      const id = String(t.player_id || t.id || t.playerId);
      if (skipId && id === skipId) return;
      const item = buildListItem(t);
      list.appendChild(item);
    });

    listContainer.appendChild(list);
  }

  function importTargetToYata(playerId, note = "", color = 0) {
    const apiKey = storageGet(STORAGE_YATA_API_KEY, "") || "";
    if (!apiKey) return Promise.reject(new Error("Missing YATA API key"));
    if (!playerId) return Promise.reject(new Error("Missing playerId"));

    if (isPlayerInTargets(playerId)) {
      return Promise.resolve({
        skipped: true,
        message: "Already in local targets",
      });
    }

    const payload = { key: apiKey, targets: {} };
    payload.targets[String(playerId)] = {
      note: String(note || ""),
      color: Number(color) || 0,
    };

    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: "POST",
        url: "https://yata.yt/api/v1/targets/import/",
        headers: { "Content-Type": "application/json" },
        data: JSON.stringify(payload),
        onload: function (response) {
          try {
            if (response.status < 200 || response.status >= 300) {
              throw new Error(
                "HTTP " +
                  response.status +
                  " " +
                  response.statusText +
                  ": " +
                  (response.responseText || "")
              );
            }
            let json;
            try {
              json = JSON.parse(response.responseText || "{}");
            } catch (_) {
              json = { raw: response.responseText };
            }
            resolve(json);
          } catch (err) {
            reject(err);
          }
        },
        onerror: function () {
          reject(new Error("Network error while importing target to YATA"));
        },
      });
    });
  }

  function addTargetLocally(playerId, opts = {}) {
    try {
      let arr = storageGetJson(STORAGE_YATA_TARGETS, []);
      if (!Array.isArray(arr)) arr = [];
      const exists = arr.some((t) => String(t.player_id) === String(playerId));
      if (!exists) {
        const entry = { player_id: String(playerId) };
        if (opts.name) entry.name = opts.name;
        if (typeof opts.color !== "undefined") entry.color = opts.color;
        arr.push(entry);
        storageSetJson(STORAGE_YATA_TARGETS, arr);
        storageSet(STORAGE_TIME_KEY, Date.now().toString());
        try {
          renderTargetsList(arr);
        } catch (_) {}
      }
      fetchTornUserProfile(playerId);
    } catch (e) {
      console.error("Failed to add target locally:", e);
    }
  }

  function removeFFsTargetById(playerId) {
    try {
      let arr = storageGetJson(STORAGE_FFs_TARGETS, []);
      if (!Array.isArray(arr) || arr.length === 0) return false;
      const pidStr = String(playerId);
      const newArr = arr.filter(
        (t) => String(t.player_id || t.id || t.playerId) !== pidStr
      );
      if (newArr.length === arr.length) return false;
      try {
        storageSetJson(STORAGE_FFs_TARGETS, newArr);
      } catch (e) {
        console.error("Failed to persist FFs targets after removal:", e);
      }
      return true;
    } catch (e) {
      console.error("Failed to remove FFs target:", e);
      return false;
    }
  }

  function loadTargetsData() {
    const cachedTime = storageGet(STORAGE_TIME_KEY, null);
    const now = Date.now();
    const cached = storageGetJson(STORAGE_YATA_TARGETS, null);
    if (
      Array.isArray(cached) &&
      cachedTime &&
      now - parseInt(cachedTime, 10) < TWENTY_MINUTES
    ) {
      try {
        renderTargetsList(cached);
      } catch (e) {
        console.error("Failed to render cached targets:", e);
        fetchAndStoreTargetsData();
      }
    } else {
      fetchAndStoreTargetsData(false);
    }

    setTimeout(() => {
      try {
        const ffKey = storageGet(STORAGE_FFs_API_KEY, "") || "";
        const arr = storageGetJson(STORAGE_FFs_TARGETS, []);
        if (ffKey && (!Array.isArray(arr) || arr.length === 0)) {
          importFFsTargets(
            {},
            { addToLocal: true, render: true, startUpdater: false }
          ).catch(() => {
            /* ignore import errors on startup */
          });
        }
      } catch (_) {}
    }, 1500);

    startTabCoordination();
  }

  function getProfileXIDFromUrl() {
    try {
      const url = new URL(window.location.href);
      const xid = url.searchParams.get("XID") || url.searchParams.get("xid");
      if (xid && /^\d+$/.test(xid)) return xid;
    } catch (_) {
      /* ignore */
    }
    const m = (window.location.href || "").match(/[?&]XID=(\d+)/i);
    return m ? m[1] : null;
  }

  function ensureProfileImportButton() {
    const xid = getProfileXIDFromUrl();
    if (!xid) return;

    const container = document.querySelector(".buttons-list");
    if (!container) return;

    const existing = document.getElementById("yata-add-target-btn");
    if (existing) existing.remove();

    const btn = document.createElement("a");
    btn.id = "yata-add-target-btn";
    btn.href = "#";
    btn.dataset.xid = String(xid);
    btn.className = "profile-button clickable";
    btn.style.display = "inline-flex";
    btn.style.alignItems = "center";

    const icon = document.createElement("img");
    const iconColor = isPlayerInTargets(xid) ? "1e1e1e" : "d4d4d4";
    icon.src = `https://img.icons8.com/?size=100&id=24921&format=png&color=${iconColor}`;
    icon.alt = "Add to YATA";
    icon.width = 32;
    icon.height = 32;
    icon.style.mixBlendMode = "difference";

    const iconWrapper = document.createElement("span");
    iconWrapper.style.display = "inline-flex";
    iconWrapper.style.width = "44px";
    iconWrapper.style.height = "44px";
    iconWrapper.style.alignItems = "center";
    iconWrapper.style.justifyContent = "center";
    iconWrapper.appendChild(icon);

    btn.appendChild(iconWrapper);

    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      if (btn.dataset.loading === "1") return;
      btn.dataset.loading = "1";
      try {
        if (isPlayerInTargets(xid)) {
          const prevTitle = btn.title;
          btn.title = "Already in targets";
          setTimeout(() => {
            btn.title = prevTitle || "";
          }, 1500);
        } else {
          const res = await importTargetToYata(xid, "", 0);
          if (!res || !res.skipped) {
            addTargetLocally(xid, { color: 0 });
          }
        }
      } catch (err) {
        console.error("YATA import failed:", err);
        return;
      }
      setTimeout(() => {
        btn.dataset.loading = "";
      }, 1000);
    });

    container.appendChild(btn);
  }

  function initProfileEnhancement() {
    setInterval(() => {
      if (window.location.pathname.includes("/profiles.php")) {
        ensureProfileImportButton();
      }
    }, 1000);
  }

  function ensureUserListImportButtons() {
    if (!window.location.href.includes("page.php?sid=UserList")) return;
    const list = document.querySelector("ul.user-info-list-wrap");
    if (!list) return;

    list.querySelectorAll("li").forEach((li) => {
      if (li.querySelector(".yata-add-target-btn")) return;

      const userClass = Array.from(li.classList).find((c) =>
        /^user\d+$/.test(c)
      );
      if (!userClass) return;
      const m = userClass.match(/^user(\d+)$/);
      if (!m) return;
      const xid = m[1];

      const btn = document.createElement("a");
      btn.className = "yata-add-target-btn profile-button clickable";
      btn.href = "#";
      btn.dataset.xid = String(xid);
      btn.style.display = "inline-flex";
      btn.style.alignItems = "center";
      btn.style.position = "relative";
      btn.style.right = "20px";
      btn.style.top = "6px";
      btn.style.zIndex = "10";
      const iconColor = isPlayerInTargets(xid) ? "1e1e1e" : "d4d4d4";
      btn.title = isPlayerInTargets(xid) ? "Already in targets" : "Add to YATA";

      btn.innerHTML = `
                <span style="display:inline-flex;width:28px;height:28px;align-items:center;justify-content:center;">
                    <img src="https://img.icons8.com/?size=100&id=24921&format=png&color=${iconColor}" alt="Add to YATA" width="20" height="20" style="mix-blend-mode:difference;" />
                </span>
            `;

      btn.addEventListener("click", async (e) => {
        e.preventDefault();
        if (btn.dataset.loading === "1") return;
        btn.dataset.loading = "1";
        try {
          if (isPlayerInTargets(xid)) {
            const prev = btn.title;
            btn.title = "Already in targets";
            setTimeout(() => {
              btn.title = prev || "";
            }, 1500);
          } else {
            const res = await importTargetToYata(xid, "", 0);
            if (!res || !res.skipped) {
              addTargetLocally(xid, { color: 0 });
            }
          }
        } catch (err) {
          console.error("YATA import failed (list):", err);
        }
        setTimeout(() => {
          btn.dataset.loading = "";
        }, 1000);
      });

      const targetContainer = li.querySelector("span.level");
      if (targetContainer) {
        targetContainer.prepend(btn);
      } else {
        li.appendChild(btn);
      }
    });
  }

  function initUserListEnhancement() {
    setInterval(() => {
      ensureUserListImportButtons();
    }, 1000);
  }

  loadTargetsData();
  initProfileEnhancement();
  initUserListEnhancement();
})();
