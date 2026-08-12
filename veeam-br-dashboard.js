/**
 * Veeam Backup & Replication dashboard strategy.
 *
 * Builds a dashboard from whatever the ha-veeam-br integration has created, so there is
 * nothing to maintain by hand as jobs and repositories come and go.
 *
 * Dashboard:
 *   strategy:
 *     type: custom:veeam-br
 *
 * A single view inside an existing dashboard:
 *   views:
 *     - strategy:
 *         type: custom:veeam-br
 *         group: jobs
 *
 * Options (all optional):
 *   group                 Only for the view strategy: overview | jobs | repositories |
 *                         infrastructure (which covers the HA cluster, proxies, WAN
 *                         accelerators, servers and licensing). Defaults to overview.
 *   include_diagnostics   Include diagnostic entities. Default false, since they are mostly
 *                         build numbers and IDs.
 *   include_config        Include config-category entities. Default true — the job start and
 *                         stop buttons live here.
 *   include_hidden        Include entities the user hid. Default false: hiding something and
 *                         having it reappear is not what anyone means.
 *   repository_warn_at    Used-space percentage treated as a warning on the overview.
 *                         Default 85.
 */

const INTEGRATION = "veeam_br";

/** Device models set by the integration, in the order they should appear. */
const MODEL = {
  JOB: "Backup Job",
  REPOSITORY: "Backup Repository",
  SOBR: "Scale-Out Backup Repository",
  PROXY: "Backup Proxy",
  WAN: "WAN Accelerator",
  SERVER: "Backup & Replication Server",
  LICENSE: "License",
  CLUSTER: "High Availability Cluster",
};

const GROUPS = ["overview", "jobs", "repositories", "infrastructure"];

const DEFAULTS = {
  include_diagnostics: false,
  include_config: true,
  include_hidden: false,
  repository_warn_at: 85,
};

/** Suffixes of the entities worth showing on the overview, per model. */
const OVERVIEW_SUFFIXES = {
  [MODEL.JOB]: ["_last_result", "_status"],
  [MODEL.REPOSITORY]: ["_used_percentage", "_online"],
  [MODEL.SOBR]: ["_extent_count"],
  [MODEL.PROXY]: ["_online", "_enabled"],
  [MODEL.WAN]: ["_cache_size"],
  [MODEL.SERVER]: ["_connected", "_health", "_name"],
  [MODEL.LICENSE]: ["_status", "_expiration_date"],
  [MODEL.CLUSTER]: ["_online", "_failover_in_progress"],
};

function options(config) {
  return { ...DEFAULTS, ...(config || {}) };
}

function deviceName(device) {
  return device.name_by_user || device.name || "Unnamed";
}

function byName(a, b) {
  return deviceName(a).localeCompare(deviceName(b), undefined, { numeric: true });
}

/**
 * Entities belonging to this integration, keyed by device.
 *
 * Filtering on the registry rather than on entity_id patterns means renamed entities are
 * still found, and entities the user disabled or hid stay out of the way.
 */
function entitiesByDevice(entities, opts) {
  const byDevice = new Map();

  for (const entity of entities) {
    if (entity.platform !== INTEGRATION) continue;
    if (entity.disabled_by) continue;
    if (entity.hidden_by && !opts.include_hidden) continue;
    if (entity.entity_category === "diagnostic" && !opts.include_diagnostics) continue;
    if (entity.entity_category === "config" && !opts.include_config) continue;
    if (!entity.device_id) continue;

    const list = byDevice.get(entity.device_id) || [];
    list.push(entity);
    byDevice.set(entity.device_id, list);
  }

  // Primary entities first, then config, then diagnostics — so a card leads with the state
  // someone actually opened the dashboard to see
  const rank = { null: 0, undefined: 0, config: 1, diagnostic: 2 };
  for (const list of byDevice.values()) {
    list.sort((a, b) => {
      const byCategory = (rank[a.entity_category] ?? 0) - (rank[b.entity_category] ?? 0);
      if (byCategory !== 0) return byCategory;
      return (a.entity_id || "").localeCompare(b.entity_id || "");
    });
  }

  return byDevice;
}

/** Devices of this integration that still have at least one usable entity. */
function devicesWithEntities(devices, byDevice) {
  return devices
    .filter((device) => !device.disabled_by && byDevice.has(device.id))
    .sort(byName);
}

function groupByModel(devices) {
  const groups = new Map();
  for (const device of devices) {
    const model = device.model || "Other";
    const list = groups.get(model) || [];
    list.push(device);
    groups.set(model, list);
  }
  return groups;
}

/**
 * Map config entry id -> a label for it.
 *
 * With one server the label is unused; with several, sections are suffixed with the server
 * name so two identically named jobs on different servers can be told apart.
 */
function entryLabels(devices) {
  const labels = new Map();
  for (const device of devices) {
    if (device.model !== MODEL.SERVER) continue;
    for (const entryId of device.config_entries || []) {
      labels.set(entryId, deviceName(device));
    }
  }
  return labels;
}

function entryOf(device) {
  return (device.config_entries || [])[0];
}

function tile(entityId, extra = {}) {
  return { type: "tile", entity: entityId, ...extra };
}

function heading(text, extra = {}) {
  return { type: "heading", heading: text, ...extra };
}

function grid(cards) {
  return { type: "grid", cards };
}

function section(title, cards, extra = {}) {
  return grid([heading(title, extra), ...cards]);
}

function markdown(content) {
  return { type: "markdown", content };
}

/** One section per device, listing its entities. */
function deviceSections(devices, byDevice, labels, multiServer) {
  return devices.map((device) => {
    const entities = byDevice.get(device.id) || [];
    const label = multiServer ? labels.get(entryOf(device)) : null;
    const title = label ? `${deviceName(device)} — ${label}` : deviceName(device);
    return section(
      title,
      entities.map((entity) => tile(entity.entity_id)),
    );
  });
}

function pickOverviewEntities(device, entities) {
  const suffixes = OVERVIEW_SUFFIXES[device.model];
  if (!suffixes) return entities.slice(0, 2);

  const picked = suffixes
    .map((suffix) => entities.find((entity) => entity.entity_id.endsWith(suffix)))
    .filter(Boolean);

  // A model whose expected entities are all missing still deserves a tile
  return picked.length ? picked : entities.slice(0, 1);
}

/** Compact view: a few tiles per device, grouped by kind. */
function overviewSections(groups, byDevice, labels, multiServer, opts) {
  const sections = [];

  const order = [
    MODEL.JOB,
    MODEL.REPOSITORY,
    MODEL.SOBR,
    MODEL.PROXY,
    MODEL.WAN,
    MODEL.CLUSTER,
    MODEL.SERVER,
    MODEL.LICENSE,
  ];
  const titles = {
    [MODEL.JOB]: "Backup jobs",
    [MODEL.REPOSITORY]: "Repositories",
    [MODEL.SOBR]: "Scale-out repositories",
    [MODEL.PROXY]: "Backup proxies",
    [MODEL.WAN]: "WAN accelerators",
    [MODEL.CLUSTER]: "High availability",
    [MODEL.SERVER]: "Servers",
    [MODEL.LICENSE]: "Licensing",
  };

  for (const model of order) {
    const devices = groups.get(model);
    if (!devices || !devices.length) continue;

    const cards = [];
    for (const device of devices) {
      const entities = byDevice.get(device.id) || [];
      for (const entity of pickOverviewEntities(device, entities)) {
        const label = multiServer ? labels.get(entryOf(device)) : null;
        cards.push(
          tile(entity.entity_id, {
            name: label ? `${deviceName(device)} (${label})` : deviceName(device),
          }),
        );
      }
    }

    if (cards.length) {
      sections.push(section(titles[model] || model, cards));
    }
  }

  if (groups.has(MODEL.REPOSITORY)) {
    sections.push(
      section("Notes", [
        markdown(
          `Repositories at or above **${opts.repository_warn_at}%** used are worth a look.` +
            " Tiles above show current usage.",
        ),
      ]),
    );
  }

  return sections;
}

function emptyView() {
  return {
    title: "Veeam",
    icon: "mdi:backup-restore",
    cards: [
      markdown(
        "### No Veeam entities found\n\n" +
          "This dashboard builds itself from the " +
          "[Veeam Backup & Replication integration](https://github.com/Cenvora/ha-veeam-br). " +
          "Add the integration under **Settings → Devices & Services**, then reload this page.\n\n" +
          "If the integration is already set up, its entities may all be disabled or hidden.",
      ),
    ],
  };
}

/** Build the sections for one group. Exported for the view strategy and for tests. */
export function buildSections(group, registries, config) {
  const opts = options(config);
  const byDevice = entitiesByDevice(registries.entities, opts);
  const devices = devicesWithEntities(registries.devices, byDevice);
  const groups = groupByModel(devices);
  const labels = entryLabels(devices);
  const multiServer = new Set(devices.map(entryOf).filter(Boolean)).size > 1;

  if (!devices.length) return null;

  switch (group) {
    case "jobs":
      return deviceSections(groups.get(MODEL.JOB) || [], byDevice, labels, multiServer);
    case "repositories":
      return deviceSections(
        [...(groups.get(MODEL.REPOSITORY) || []), ...(groups.get(MODEL.SOBR) || [])],
        byDevice,
        labels,
        multiServer,
      );
    case "infrastructure":
      return deviceSections(
        [
          ...(groups.get(MODEL.CLUSTER) || []),
          ...(groups.get(MODEL.PROXY) || []),
          ...(groups.get(MODEL.WAN) || []),
          ...(groups.get(MODEL.SERVER) || []),
          ...(groups.get(MODEL.LICENSE) || []),
        ],
        byDevice,
        labels,
        multiServer,
      );
    case "overview":
    default:
      return overviewSections(groups, byDevice, labels, multiServer, opts);
  }
}

/** Build the whole dashboard. Exported for tests. */
export function buildDashboard(registries, config) {
  const views = [];

  const overview = buildSections("overview", registries, config);
  if (overview === null) {
    return { views: [emptyView()] };
  }

  views.push({
    title: "Overview",
    path: "overview",
    icon: "mdi:backup-restore",
    type: "sections",
    max_columns: 3,
    sections: overview,
  });

  const rest = [
    { group: "jobs", title: "Jobs", path: "jobs", icon: "mdi:file-tree" },
    { group: "repositories", title: "Repositories", path: "repositories", icon: "mdi:database" },
    {
      group: "infrastructure",
      title: "Infrastructure",
      path: "infrastructure",
      icon: "mdi:server",
    },
  ];

  for (const { group, title, path, icon } of rest) {
    const sections = buildSections(group, registries, config);
    // Skip a view with nothing in it rather than showing an empty tab
    if (!sections || !sections.length) continue;
    views.push({ title, path, icon, type: "sections", max_columns: 3, sections });
  }

  return { views };
}

async function loadRegistries(hass) {
  const [devices, entities] = await Promise.all([
    hass.callWS({ type: "config/device_registry/list" }),
    hass.callWS({ type: "config/entity_registry/list" }),
  ]);
  return { devices, entities };
}

// customElements.define requires an HTMLElement subclass, but Home Assistant only ever calls
// the static generate(). Resolving the base at runtime keeps the module importable outside a
// browser, which is what makes the build logic testable.
const StrategyBase = typeof HTMLElement === "undefined" ? class {} : HTMLElement;

class VeeamBrDashboardStrategy extends StrategyBase {
  static async generate(config, hass) {
    return buildDashboard(await loadRegistries(hass), config);
  }
}

class VeeamBrViewStrategy extends StrategyBase {
  static async generate(config, hass) {
    const group = GROUPS.includes(config?.group) ? config.group : "overview";
    const sections = buildSections(group, await loadRegistries(hass), config);

    if (!sections || !sections.length) {
      return { type: "sections", sections: [section("Veeam", [markdown("No Veeam entities found.")])] };
    }

    return { type: "sections", max_columns: 3, sections };
  }
}

// Registered defensively: a dashboard can be reloaded without a full page refresh, and
// defining an existing element throws.
if (typeof customElements !== "undefined") {
  if (!customElements.get("ll-strategy-dashboard-veeam-br")) {
    customElements.define("ll-strategy-dashboard-veeam-br", VeeamBrDashboardStrategy);
  }
  if (!customElements.get("ll-strategy-view-veeam-br")) {
    customElements.define("ll-strategy-view-veeam-br", VeeamBrViewStrategy);
  }
}

console.info("%c VEEAM-BR-DASHBOARD %c strategy loaded ", "color:white;background:#00b336", "");
